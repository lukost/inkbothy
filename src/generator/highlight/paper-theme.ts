import type { ThemeRegistration } from 'shiki/core';

export const PAPER_THEME = 'paper';
const BG = '#f2f0eb';
const FG = '#1d1d1f';

/** Light code theme built from the site's "neutral paper" palette; every colour is at least 4.5:1 on `BG`. */
export const paperTheme: ThemeRegistration = {
  name: PAPER_THEME,
  type: 'light',
  colors: { 'editor.background': BG, 'editor.foreground': FG },
  settings: [
    { settings: { foreground: FG, background: BG } },
    {
      scope: ['comment', 'punctuation.definition.comment'],
      settings: { foreground: '#5f656d', fontStyle: 'italic' },
    },
    {
      scope: ['keyword', 'storage', 'storage.type', 'storage.modifier', 'keyword.control'],
      settings: { foreground: '#7a3b9c' },
    },
    {
      scope: ['string', 'string.quoted', 'punctuation.definition.string', 'markup.inserted'],
      settings: { foreground: '#2c6a31' },
    },
    {
      scope: [
        'constant.numeric',
        'constant.language',
        'constant.character',
        'constant.other',
        'support.constant',
      ],
      settings: { foreground: '#a24f00' },
    },
    {
      scope: ['entity.name.function', 'support.function', 'meta.function-call', 'entity.name.tag'],
      settings: { foreground: '#1f5a86' },
    },
    {
      scope: [
        'entity.name.type',
        'entity.name.class',
        'support.type',
        'support.class',
        'entity.other.inherited-class',
      ],
      settings: { foreground: '#0d6d60' },
    },
    {
      scope: [
        'meta.preprocessor',
        'keyword.control.directive',
        'punctuation.definition.directive',
        'entity.name.function.preprocessor',
        'meta.decorator',
      ],
      settings: { foreground: '#8a3a2a' },
    },
    {
      scope: ['keyword.operator', 'punctuation', 'variable', 'variable.other', 'meta.brace'],
      settings: { foreground: FG },
    },
    {
      scope: ['string.regexp'],
      settings: { foreground: '#8a3a2a' },
    },
    {
      scope: ['constant.other.character-class.regexp'],
      settings: { foreground: '#0d6d60' },
    },
    {
      scope: ['keyword.operator.quantifier.regexp'],
      settings: { foreground: '#7a3b9c' },
    },
    { scope: ['constant.character.escape'], settings: { foreground: '#a24f00' } },
    { scope: ['meta.diff.header'], settings: { foreground: '#1f5a86' } },
    { scope: ['meta.diff.range'], settings: { foreground: '#7a3b9c' } },
    { scope: ['markup.changed'], settings: { foreground: '#a24f00' } },
    { scope: ['markup.heading'], settings: { foreground: '#1f5a86', fontStyle: 'bold' } },
    { scope: ['markup.deleted'], settings: { foreground: '#8a3a2a' } },
    { scope: ['markup.bold'], settings: { fontStyle: 'bold' } },
    { scope: ['markup.italic'], settings: { fontStyle: 'italic' } },
    { scope: ['invalid'], settings: { foreground: '#8a3a2a', fontStyle: 'underline' } },
  ],
};
