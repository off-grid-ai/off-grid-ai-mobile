import React, { useCallback, useMemo, useState } from 'react';
import { Clipboard, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../theme';
import type { ThemeColors } from '../theme';
import { FONTS, SPACING, TYPOGRAPHY } from '../constants';
import logger from '../utils/logger';

export function preprocessMarkdown(text: string): string {
  return text.replaceAll(/(\d)\*(?=\d)/g, String.raw`$1\*`);
}

function CodeBlock({ language, code, colors }: { language: string; code: string; colors: ThemeColors }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    Clipboard.setString(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  return (
    <View style={[codeBlockStyles.container, { backgroundColor: colors.surfaceLight, borderColor: colors.border }]}>
      <View style={[codeBlockStyles.header, { borderBottomColor: colors.borderLight }]}>
        <Text style={[codeBlockStyles.lang, { color: colors.textMuted }]}>{language}</Text>
        <Pressable onPress={handleCopy} style={codeBlockStyles.copyBtn} hitSlop={8}>
          <Icon name={copied ? 'check' : 'copy'} size={13} color={copied ? colors.primary : colors.textMuted} />
          <Text style={[codeBlockStyles.copyLabel, { color: copied ? colors.primary : colors.textMuted }]}>
            {copied ? 'Copied' : 'Copy'}
          </Text>
        </Pressable>
      </View>
      <Text selectable style={[codeBlockStyles.code, { color: colors.text, fontFamily: FONTS.mono }]}>
        {code}
      </Text>
    </View>
  );
}

const codeBlockStyles = StyleSheet.create({
  container: {
    borderRadius: 6,
    borderWidth: 1,
    marginVertical: SPACING.sm,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lang: {
    fontSize: 11,
    fontFamily: FONTS.mono,
    textTransform: 'uppercase',
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  copyLabel: {
    fontSize: 11,
  },
  code: {
    fontSize: 12,
    lineHeight: 18,
    padding: SPACING.md,
  },
});

type Segment =
  | { type: 'markdown'; content: string }
  | { type: 'code'; language: string; code: string };

function splitSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  const fence = /^```([^\n]*)\n([\s\S]*?)^```/gm;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fence.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const md = text.slice(lastIndex, match.index).trim();
      if (md) segments.push({ type: 'markdown', content: md });
    }
    segments.push({ type: 'code', language: match[1].trim(), code: match[2] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    const md = text.slice(lastIndex).trim();
    if (md) segments.push({ type: 'markdown', content: md });
  }

  return segments;
}

interface MarkdownTextProps {
  children: string;
  dimmed?: boolean;
}

export function MarkdownText({ children, dimmed }: MarkdownTextProps) {
  const { colors } = useTheme();

  const markdownStyle = useMemo(() => createMarkdownStyle(colors, dimmed), [colors, dimmed]);

  const segments = useMemo(() => splitSegments(preprocessMarkdown(children)), [children]);

  const handleLinkPress = useCallback((event: { url: string }) => {
    logger.log(`[MarkdownText] link pressed: ${event.url}`);
    Linking.openURL(event.url);
  }, []);

  return (
    <View>
      {segments.map((seg, i) =>
        seg.type === 'code' ? (
          <CodeBlock key={i} language={seg.language} code={seg.code} colors={colors} />
        ) : (
          <EnrichedMarkdownText
            key={i}
            markdown={seg.content}
            markdownStyle={markdownStyle}
            selectable
            onLinkPress={handleLinkPress}
          />
        )
      )}
    </View>
  );
}

function createMarkdownStyle(colors: ThemeColors, dimmed?: boolean) {
  const textColor = dimmed ? colors.textSecondary : colors.text;

  return {
    paragraph: {
      fontSize: TYPOGRAPHY.body.fontSize,
      fontFamily: TYPOGRAPHY.body.fontFamily,
      color: textColor,
      lineHeight: 20,
      marginBottom: SPACING.sm,
    },
    h1: {
      fontSize: 20,
      fontFamily: FONTS.mono,
      color: textColor,
      marginTop: SPACING.sm,
      marginBottom: SPACING.xs,
    },
    h2: {
      fontSize: TYPOGRAPHY.h2.fontSize,
      fontFamily: FONTS.mono,
      color: textColor,
      marginTop: SPACING.sm,
      marginBottom: SPACING.xs,
    },
    h3: {
      fontSize: TYPOGRAPHY.h3.fontSize,
      fontFamily: FONTS.mono,
      color: textColor,
      marginTop: SPACING.xs,
      marginBottom: 2,
    },
    h4: {
      fontSize: TYPOGRAPHY.h3.fontSize,
      fontFamily: FONTS.mono,
      color: textColor,
      marginTop: SPACING.xs,
      marginBottom: 2,
    },
    h5: {
      fontSize: 12,
      fontFamily: FONTS.mono,
      color: textColor,
      marginTop: SPACING.xs,
      marginBottom: 2,
    },
    h6: {
      fontSize: 11,
      fontFamily: FONTS.mono,
      color: textColor,
      marginTop: SPACING.xs,
      marginBottom: 2,
    },
    strong: {
      fontWeight: 'bold' as const,
    },
    em: {
      fontStyle: 'italic' as const,
    },
    code: {
      fontFamily: FONTS.mono,
      fontSize: 13,
      color: colors.primary,
      backgroundColor: colors.surfaceLight,
    },
    codeBlock: {
      fontFamily: FONTS.mono,
      fontSize: 12,
      color: textColor,
      backgroundColor: colors.surfaceLight,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 6,
      padding: SPACING.md,
      marginBottom: SPACING.sm,
    },
    blockquote: {
      borderColor: colors.primary,
      borderWidth: 3,
      backgroundColor: colors.surfaceLight,
      marginBottom: SPACING.sm,
    },
    list: {
      fontSize: TYPOGRAPHY.body.fontSize,
      fontFamily: TYPOGRAPHY.body.fontFamily,
      color: textColor,
      lineHeight: 20,
      marginBottom: SPACING.xs,
    },
    link: {
      color: colors.primary,
      underline: true,
    },
    thematicBreak: {
      color: colors.border,
      height: 1,
      marginTop: SPACING.md,
      marginBottom: SPACING.md,
    },
    table: {
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 4,
      marginBottom: SPACING.sm,
    },
  };
}
