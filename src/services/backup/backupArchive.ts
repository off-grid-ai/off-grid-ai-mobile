import RNFS from 'react-native-fs';
import { zip, unzip } from 'react-native-zip-archive';
import type { ArchivePort } from '@offgrid/sync/portable';

// Mobile's archive port: the ONE place that assembles a backup zip on disk and
// reads one back. Pure I/O behind the engine's ArchivePort interface — RNFS for
// files, react-native-zip-archive for pack/unpack. Staging + unpacking happen in
// the caches dir (transient); restored media lands in the app's Documents dir
// under a per-import folder so two imports can't clobber each other's files.

const stripScheme = (p: string): string => p.replace(/^file:\/\//, '');

class RnArchive implements ArchivePort {
  private seq = 0;
  private importId = 'default';

  private parentOf(absPath: string): string {
    const i = absPath.lastIndexOf('/');
    return i > 0 ? absPath.slice(0, i) : absPath;
  }

  private async ensureDir(dir: string): Promise<void> {
    if (!(await RNFS.exists(dir))) await RNFS.mkdir(dir); // RNFS.mkdir creates intermediate dirs
  }

  async stageDir(): Promise<string> {
    const dir = `${RNFS.CachesDirectoryPath}/offgrid-stage-${Date.now()}-${this
      .seq++}`;
    await RNFS.mkdir(dir);
    return dir;
  }

  async writeText(absPath: string, text: string): Promise<void> {
    await this.ensureDir(this.parentOf(absPath));
    await RNFS.writeFile(absPath, text, 'utf8');
  }

  readText(absPath: string): Promise<string> {
    return RNFS.readFile(absPath, 'utf8');
  }

  async copyInto(srcPath: string, destAbsPath: string): Promise<void> {
    await this.ensureDir(this.parentOf(destAbsPath));
    await RNFS.copyFile(stripScheme(srcPath), destAbsPath);
  }

  pack(stageDir: string, suggestedName: string): Promise<string> {
    return zip(stageDir, `${RNFS.CachesDirectoryPath}/${suggestedName}`);
  }

  async unpack(archivePath: string): Promise<string> {
    this.importId = `${Date.now()}-${this.seq++}`;
    const dir = `${RNFS.CachesDirectoryPath}/offgrid-unpack-${this.importId}`;
    await unzip(stripScheme(archivePath), dir);
    return dir;
  }

  restorePathFor(key: string): string {
    // key looks like "files/img/0.png"; land it under a per-import media folder
    // in the app container so restored files persist and don't collide.
    return `${RNFS.DocumentDirectoryPath}/offgrid-media/${
      this.importId
    }/${key.replace(/^files\//, '')}`;
  }

  join(...parts: string[]): string {
    return parts.join('/');
  }
}

export const backupArchive: ArchivePort = new RnArchive();
