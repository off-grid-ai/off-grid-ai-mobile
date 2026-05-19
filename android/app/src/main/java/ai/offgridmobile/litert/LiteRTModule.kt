package ai.offgridmobile.litert

import android.util.Log
import android.app.ActivityManager
import android.content.Context
import android.os.Debug
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import ai.offgridmobile.SafePromise
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.BenchmarkInfo
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.ExperimentalApi
import com.google.ai.edge.litertlm.SamplerConfig
import kotlinx.coroutines.*
import java.io.File
import java.io.InputStream
import java.io.ByteArrayOutputStream
import android.net.Uri
import android.graphics.Bitmap
import android.graphics.BitmapFactory

class LiteRTModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "LiteRTModule"

        // Streaming events sent to JS
        const val EVENT_TOKEN = "litert_token"
        const val EVENT_THINKING = "litert_thinking"
        const val EVENT_COMPLETE = "litert_complete"
        const val EVENT_ERROR = "litert_error"

        // Timeouts per backend tier
        private const val NPU_TIMEOUT_MS = 45_000L
        private const val GPU_TIMEOUT_MS = 20_000L
        private const val CPU_TIMEOUT_MS = 15_000L
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private var engine: Engine? = null
    private var conversation: com.google.ai.edge.litertlm.Conversation? = null
    private var activeBackend: String = "cpu"
    private var supportsVision: Boolean = false
    private var currentJob: Job? = null

    override fun getName(): String = "LiteRTModule"

    // -------------------------------------------------------------------------
    // loadModel
    // -------------------------------------------------------------------------

    @ReactMethod
    fun loadModel(modelPath: String, backendStr: String, visionEnabled: Boolean, promise: Promise) {
        val safe = SafePromise(promise, TAG)
        Log.i(TAG, "loadModel — path=$modelPath backend=$backendStr vision=$visionEnabled")

        scope.launch {
            try {
                // Unload any existing engine first
                cleanupEngine()

                val requestedBackend = parseBackend(backendStr)
                Log.i(TAG, "loadModel — attempting backend chain from $backendStr")

                val resolvedBackend = initializeWithFallback(modelPath, requestedBackend, visionEnabled)
                activeBackend = backendName(resolvedBackend)
                supportsVision = visionEnabled

                Log.i(TAG, "loadModel — success on backend=$activeBackend vision=$supportsVision")
                safe.resolve(activeBackend)
            } catch (e: Exception) {
                Log.e(TAG, "loadModel — all backends failed: ${e.message}", e)
                safe.reject("LITERT_LOAD_ERROR", "Failed to load model: ${e.message}", e)
            }
        }
    }

    // 3-tier fallback: NPU → GPU → CPU
    private suspend fun initializeWithFallback(modelPath: String, requested: Backend, visionEnabled: Boolean): Backend {
        val chain = when (requested) {
            is Backend.NPU -> listOf(
                Backend.NPU(nativeLibraryDir = reactContext.applicationInfo.nativeLibraryDir),
                Backend.GPU(),
                Backend.CPU(),
            )
            is Backend.GPU -> listOf(Backend.GPU(), Backend.CPU())
            else           -> listOf(Backend.CPU())
        }

        var lastError: Exception? = null
        for (backend in chain) {
            val name = backendName(backend)
            Log.i(TAG, "initializeWithFallback — trying $name vision=$visionEnabled")
            try {
                val cfg = EngineConfig(
                    modelPath = modelPath,
                    backend = backend,
                    cacheDir = null,
                    visionBackend = if (visionEnabled) Backend.GPU() else null,
                )
                val eng = Engine(cfg)
                val timeoutMs = when (backend) {
                    is Backend.NPU -> NPU_TIMEOUT_MS
                    is Backend.GPU -> GPU_TIMEOUT_MS
                    else           -> CPU_TIMEOUT_MS
                }
                withTimeout(timeoutMs) {
                    eng.initialize()
                }
                engine = eng
                Log.i(TAG, "initializeWithFallback — $name succeeded")
                return backend
            } catch (e: Exception) {
                Log.w(TAG, "initializeWithFallback — $name failed: ${e.message}")
                engine?.close()
                engine = null
                lastError = e
                if (backend == chain.last()) break
                Log.i(TAG, "initializeWithFallback — falling back to next tier")
            }
        }
        throw lastError ?: IllegalStateException("All backends failed")
    }

    // -------------------------------------------------------------------------
    // resetConversation — closes and recreates Conversation only, Engine stays
    // -------------------------------------------------------------------------

    @ReactMethod
    fun resetConversation(systemPrompt: String, temperature: Double, topK: Int, topP: Double, promise: Promise) {
        val safe = SafePromise(promise, TAG)
        Log.i(TAG, "resetConversation — systemPrompt length=${systemPrompt.length} temperature=$temperature topK=$topK topP=$topP")

        scope.launch {
            try {
                val eng = engine
                if (eng == null) {
                    Log.w(TAG, "resetConversation — no engine loaded")
                    safe.reject("LITERT_NOT_LOADED", "No model loaded", null)
                    return@launch
                }

                // Close existing conversation first
                closeConversation()

                // SamplerConfig is not supported on NPU
                val samplerConfig = if (activeBackend == "npu") {
                    Log.i(TAG, "resetConversation — NPU backend, skipping SamplerConfig")
                    null
                } else {
                    SamplerConfig(
                        topK = topK,
                        topP = topP,
                        temperature = temperature,
                    )
                }

                val convConfig = ConversationConfig(
                    systemInstruction = if (systemPrompt.isNotEmpty())
                        Contents.of(systemPrompt) else null,
                    samplerConfig = samplerConfig,
                )

                conversation = eng.createConversation(convConfig)
                Log.i(TAG, "resetConversation — new conversation created")
                safe.resolve(null)
            } catch (e: Exception) {
                Log.e(TAG, "resetConversation — error: ${e.message}", e)
                safe.reject("LITERT_CONV_ERROR", "Failed to reset conversation: ${e.message}", e)
            }
        }
    }

    // -------------------------------------------------------------------------
    // sendMessage — sends only the current user turn, library holds history
    // -------------------------------------------------------------------------

    @ReactMethod
    fun sendMessage(text: String, imageUri: String?, promise: Promise) {
        val safe = SafePromise(promise, TAG)
        Log.i(TAG, "sendMessage — text length=${text.length} hasImage=${imageUri != null}")

        scope.launch {
            // Wait for any in-flight generation to finish
            currentJob?.join()

            val conv = conversation
            if (conv == null) {
                Log.w(TAG, "sendMessage — no conversation, call resetConversation first")
                safe.reject("LITERT_NO_CONV", "No conversation. Call resetConversation first.", null)
                return@launch
            }

            if (imageUri != null && !supportsVision) {
                Log.w(TAG, "sendMessage — image provided but model was not loaded with vision support, ignoring image")
            }

            currentJob = launch {
                try {
                    Log.i(TAG, "sendMessage — starting generation")

                    val contents = if (imageUri != null && supportsVision) {
                        Log.i(TAG, "sendMessage — reading image from URI: $imageUri")
                        val pngBytes = try {
                            readImageAsPngBytes(imageUri)
                        } catch (e: Exception) {
                            Log.e(TAG, "sendMessage — failed to read/decode image: ${e.message}", e)
                            sendEvent(EVENT_ERROR, "Failed to read image: ${e.message}")
                            safe.reject("LITERT_IMG_ERROR", "Failed to read image: ${e.message}", e)
                            return@launch
                        }
                        Log.i(TAG, "sendMessage — image decoded to PNG, bytes=${pngBytes.size}")
                        // Image before text — matches reference implementation order
                        Contents.of(Content.ImageBytes(pngBytes), Content.Text(text))
                    } else {
                        Contents.of(text)
                    }

                    Log.i(TAG, "sendMessage — calling sendMessageAsync")
                    conv.sendMessageAsync(contents)
                        .collect { message ->
                            val thought = message.channels["thought"]
                            if (thought != null && thought.isNotEmpty()) {
                                Log.d(TAG, "sendMessage — thinking token")
                                sendEvent(EVENT_THINKING, thought)
                            } else {
                                val token = message.contents.contents
                                    .filterIsInstance<Content.Text>()
                                    .joinToString("") { it.text }
                                Log.d(TAG, "sendMessage — token: '$token'")
                                if (token.isNotEmpty()) sendEvent(EVENT_TOKEN, token)
                            }
                        }
                    Log.i(TAG, "sendMessage — generation complete")
                    @OptIn(ExperimentalApi::class)
                    val benchmarkJson = try {
                        val b = conv.getBenchmarkInfo()
                        """{"ttft":${b.timeToFirstTokenInSecond},"decodeTokensPerSecond":${b.lastDecodeTokensPerSecond},"prefillTokensPerSecond":${b.lastPrefillTokensPerSecond},"prefillTokenCount":${b.lastPrefillTokenCount},"initTimeSeconds":${b.initTimeInSecond}}"""
                    } catch (e: Exception) {
                        Log.w(TAG, "getBenchmarkInfo failed: ${e.message}")
                        ""
                    }
                    sendEvent(EVENT_COMPLETE, benchmarkJson)
                    safe.resolve(null)
                } catch (e: CancellationException) {
                    Log.i(TAG, "sendMessage — job cancelled")
                    sendEvent(EVENT_COMPLETE, "")
                    safe.resolve(null)
                } catch (e: OutOfMemoryError) {
                    Log.e(TAG, "sendMessage — OOM: ${e.message}")
                    sendEvent(EVENT_ERROR, "Out of memory processing image")
                    safe.reject("LITERT_OOM", "Out of memory processing image", null)
                } catch (e: Exception) {
                    Log.e(TAG, "sendMessage — error: ${e.message}", e)
                    sendEvent(EVENT_ERROR, e.message ?: "Unknown error")
                    safe.reject("LITERT_GEN_ERROR", "Generation failed: ${e.message}", e)
                } finally {
                    currentJob = null
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    // stopGeneration
    // -------------------------------------------------------------------------

    @ReactMethod
    fun stopGeneration(promise: Promise) {
        val safe = SafePromise(promise, TAG)
        Log.i(TAG, "stopGeneration — cancelling current job")

        scope.launch {
            try {
                currentJob?.cancel()
                currentJob?.join()
                Log.i(TAG, "stopGeneration — done")
                safe.resolve(null)
            } catch (e: Exception) {
                Log.w(TAG, "stopGeneration — error during cancel: ${e.message}")
                safe.resolve(null) // resolve anyway — stop is best-effort
            }
        }
    }

    // -------------------------------------------------------------------------
    // unloadModel — conversation first, then engine (order is critical)
    // -------------------------------------------------------------------------

    @ReactMethod
    fun unloadModel(promise: Promise) {
        val safe = SafePromise(promise, TAG)
        Log.i(TAG, "unloadModel — starting cleanup")

        scope.launch {
            try {
                currentJob?.cancel()
                currentJob?.join()
                cleanupEngine()
                activeBackend = "cpu"
                supportsVision = false
                Log.i(TAG, "unloadModel — done")
                safe.resolve(null)
            } catch (e: Exception) {
                Log.e(TAG, "unloadModel — error: ${e.message}", e)
                safe.resolve(null) // resolve anyway
            }
        }
    }

    // -------------------------------------------------------------------------
    // getActiveBackend — returns which backend is actually running
    // -------------------------------------------------------------------------

    @ReactMethod
    fun getActiveBackend(promise: Promise) {
        SafePromise(promise, TAG).resolve(activeBackend)
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private fun closeConversation() {
        try {
            conversation?.close()
            Log.d(TAG, "closeConversation — closed")
        } catch (e: Exception) {
            Log.w(TAG, "closeConversation — error (ignored): ${e.message}")
        } finally {
            conversation = null
        }
    }

    private fun cleanupEngine() {
        // conversation MUST be closed before engine
        closeConversation()
        try {
            engine?.close()
            Log.d(TAG, "cleanupEngine — engine closed")
        } catch (e: Exception) {
            Log.w(TAG, "cleanupEngine — engine close error (ignored): ${e.message}")
        } finally {
            engine = null
        }
    }

    // -------------------------------------------------------------------------
    // getMemoryInfo — live RAM usage + process GPU memory
    // -------------------------------------------------------------------------

    @ReactMethod
    fun getMemoryInfo(promise: Promise) {
        val safe = SafePromise(promise, TAG)
        try {
            val am = reactContext.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager

            // System RAM
            val ramInfo = ActivityManager.MemoryInfo()
            am.getMemoryInfo(ramInfo)
            val totalRamMb = ramInfo.totalMem / (1024 * 1024)
            val availRamMb = ramInfo.availMem / (1024 * 1024)
            val usedRamMb = totalRamMb - availRamMb

            // Process GPU memory (graphics + GL textures) via Debug.MemoryInfo
            val memInfo = Debug.MemoryInfo()
            Debug.getMemoryInfo(memInfo)
            val gpuPrivateMb = try {
                (memInfo.getMemoryStat("summary.graphics") ?: "0").toLong() / 1024
            } catch (e: Exception) { 0L }

            val result = Arguments.createMap().apply {
                putDouble("totalRamMb", totalRamMb.toDouble())
                putDouble("usedRamMb", usedRamMb.toDouble())
                putDouble("availRamMb", availRamMb.toDouble())
                putDouble("gpuPrivateMb", gpuPrivateMb.toDouble())
                putBoolean("lowMemory", ramInfo.lowMemory)
            }
            safe.resolve(result)
        } catch (e: Exception) {
            safe.reject("MEM_ERROR", "Failed to get memory info: ${e.message}", e)
        }
    }

    private fun parseBackend(s: String): Backend = when (s.lowercase()) {
        "npu", "htp" -> Backend.NPU(
            nativeLibraryDir = reactContext.applicationInfo.nativeLibraryDir
        )
        "gpu", "opencl", "metal" -> Backend.GPU()
        else -> Backend.CPU()
    }

    private fun backendName(b: Backend): String = when (b) {
        is Backend.NPU -> "npu"
        is Backend.GPU -> "gpu"
        else           -> "cpu"
    }

    /**
     * Decode image URI → Bitmap → PNG bytes.
     * Handles content:// (gallery picker) and file:// (filesystem) URIs.
     * Converting to PNG ensures the model receives a well-formed image format
     * regardless of the source (JPEG, WebP, HEIC, etc.).
     * Max dimension is capped at 1024px to avoid OOM on large photos.
     */
    private fun readImageAsPngBytes(uri: String): ByteArray {
        val inputStream: InputStream = if (uri.startsWith("content://")) {
            reactContext.contentResolver.openInputStream(Uri.parse(uri))
                ?: throw IllegalArgumentException("Cannot open content URI: $uri")
        } else {
            File(uri.removePrefix("file://")).inputStream()
        }

        val bitmap = inputStream.use { BitmapFactory.decodeStream(it) }
            ?: throw IllegalArgumentException("Failed to decode image from URI: $uri")

        // Scale down if either dimension exceeds 1024px to avoid OOM
        val scaled = scaleBitmapIfNeeded(bitmap, maxDim = 1024)

        val out = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.PNG, 100, out)
        if (scaled !== bitmap) scaled.recycle()
        bitmap.recycle()
        return out.toByteArray()
    }

    private fun scaleBitmapIfNeeded(src: Bitmap, maxDim: Int): Bitmap {
        val w = src.width
        val h = src.height
        if (w <= maxDim && h <= maxDim) return src
        val scale = maxDim.toFloat() / maxOf(w, h)
        val newW = (w * scale).toInt()
        val newH = (h * scale).toInt()
        return Bitmap.createScaledBitmap(src, newW, newH, true)
    }

    private fun sendEvent(eventName: String, data: String) {
        try {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, data)
        } catch (e: Exception) {
            Log.w(TAG, "sendEvent — failed to emit $eventName: ${e.message}")
        }
    }

    override fun onCatalystInstanceDestroy() {
        Log.i(TAG, "onCatalystInstanceDestroy — cleaning up")
        scope.cancel()
        cleanupEngine()
        super.onCatalystInstanceDestroy()
    }
}
