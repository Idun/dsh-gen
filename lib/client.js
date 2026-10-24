/**
 * dsh-gen — client half (settings → Dsh-Gen).
 *
 * Two screens inside one settings section:
 *   1. the list: 「我的技能」 + 新建技能, then one card per saved skill;
 *   2. the editor: name / description / instructions / knowledge on the left,
 *      a live preview on the right. Editing a card reopens the same editor with
 *      the saved values, and 保存 writes them back.
 *
 * Knowledge files are picked with a plain file input, read as base64 and handed
 * to the host, which copies them under $DSH_HOME/dsh-gen/knowledge/<id>/ and
 * lists the absolute paths inside the skill body so the agent can read them.
 */
window.__ModuleLoader__.load({
  id: 'dsh-gen',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require('react');
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives');

    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    const NS = 'dsh-gen';

    /* ── remote descriptors (mirror the host's RPC surface) ─────────────── */
    const PKG = 'dsh-gen';
    const codec = (typeSymbol, parse) => {
      const schema = { parse };
      return {
        mode: 'strict',
        typeSymbol: `${PKG}#${typeSymbol}`,
        schema,
        create: () => schema,
        decode: (v) => v,
        encode: (v) => v,
      };
    };
    const passthrough = (value) => value;
    const asInput = (value) => {
      if (value === undefined || value === null) return {};
      if (typeof value !== 'object' || Array.isArray(value)) throw new Error('input must be an object');
      return value;
    };
    const withInput = () => [{ name: 'input', wire: 'input', source: 'json', codec: codec('Input', asInput) }];
    const method = (name, parameters) => ({
      id: `${PKG}#dshGen/${name}`,
      service: 'dshGen',
      namespace: 'dshGen',
      method: name,
      invocation: { kind: 'direct' },
      parameters,
      result: codec('View', passthrough),
    });
    const RPC_REMOTE = {
      package: PKG,
      descriptors: [
        method('listGens', []),
        method('saveGen', withInput()),
        method('deleteGen', withInput()),
        method('addKnowledge', withInput()),
        method('removeKnowledge', withInput()),
        method('openWorkspace', []),
        method('bindSession', withInput()),
        method('unbindSession', withInput()),
        method('sessionBinding', withInput()),
        method('readKnowledgeFile', withInput()),
        method('cloneGen', withInput()),
        method('exportGen', withInput()),
        method('exportAllGens', []),
        method('importPackage', withInput()),
      ],
    };

    /* ── styles ─────────────────────────────────────────────────────────── */
    const CSS = `
.dshg-root{display:flex;flex-direction:column;gap:16px;max-width:1120px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.dshg-head{display:flex;align-items:center;gap:10px;min-height:36px}
.dshg-head-title{display:flex;align-items:center;gap:8px;font-size:18px;font-weight:600;line-height:26px}
.dshg-head-title .dshg-info{color:var(--dsw-alias-label-tertiary);display:inline-flex}
.dshg-grow{flex:1;min-width:0}
.dshg-primary{display:inline-flex;align-items:center;gap:6px;border:0;border-radius:999px;padding:8px 18px;font:inherit;font-weight:500;color:var(--dsw-alias-label-primary-foreground);background:var(--dsw-alias-button-primary-fill);cursor:pointer}
.dshg-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.dshg-primary:disabled{opacity:.45;cursor:not-allowed}
.dshg-ghost{display:inline-flex;align-items:center;gap:6px;border:0;border-radius:8px;padding:6px 10px;font:inherit;color:var(--dsw-alias-label-secondary);background:transparent;cursor:pointer}
.dshg-ghost:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshg-cards{display:flex;flex-direction:column;gap:10px;margin:0;padding:0;list-style:none}
.dshg-card{position:relative;display:grid;grid-template-columns:36px minmax(0,1fr) auto;align-items:center;gap:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-interactive-bg-hover);padding:16px 18px;text-align:left;cursor:pointer;transition:background .15s ease,border-color .15s ease,box-shadow .15s ease}
.dshg-card:hover{background:var(--dsw-alias-interactive-bg-active);border-color:var(--dsw-alias-border-l3);box-shadow:var(--dsw-elevation-soft)}
.dshg-card-avatar{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;font-size:15px;font-weight:500;line-height:1;user-select:none}
.dshg-card-text{min-width:0;display:flex;flex-direction:column;gap:4px}
.dshg-card-name{font-size:15px;font-weight:500;line-height:22px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshg-card-desc{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshg-card-meta{color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshg-card-actions{display:flex;align-items:center;gap:2px;opacity:.75;transition:opacity .15s ease}
.dshg-card:hover .dshg-card-actions,.dshg-card:focus-within .dshg-card-actions{opacity:1}
/* Row-action motion, after the glass dock reference: the GLYPH scales, not the
   button, so the 28px hit target never moves and neighbouring buttons keep
   their spacing. A spring-ish curve overshoots slightly on entry, which is what
   makes a pointer crossing the row feel physical instead of decorative. */
.dshg-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:9px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;transition:background .18s ease,color .18s ease}
.dshg-icon-btn svg{display:block;transform-origin:center;transition:transform .42s cubic-bezier(.24,1.34,.38,1)}
.dshg-icon-btn:hover svg{transform:scale(1.16)}
.dshg-icon-btn:active svg{transform:scale(.9);transition-duration:.12s}
.dshg-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshg-icon-btn:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color);outline-offset:1px}
/* Destructive action: declared after the base rule so its colour wins. The
   error token is nearly black in this theme, so the delete glyph carries its
   own red instead of reading as another neutral button. */
.dshg-icon-btn.dshg-danger{color:#d9483f}
.dshg-icon-btn.dshg-danger:hover{background:rgba(217, 72, 63, 0.12);color:#c0392f}
/* A hidden skill keeps its row but reads as switched off: a muted glyph on a
   filled chip, so the state is obvious without hovering. */
.dshg-icon-btn.dshg-icon-btn-off{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-active)}
.dshg-icon-btn.dshg-icon-btn-off:hover{color:var(--dsw-alias-label-primary)}
.dshg-card[data-hidden=true] .dshg-card-name{color:var(--dsw-alias-label-secondary)}
.dshg-empty{display:flex;flex-direction:column;align-items:center;gap:8px;border:1px dashed var(--dsw-alias-border-l2);border-radius:14px;padding:36px 16px;color:var(--dsw-alias-label-tertiary)}
.dshg-sheet{position:fixed;inset:var(--dsh-frame-chrome-top, 0px) 0 0;z-index:1100;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.dshg-sheet-head{display:flex;align-items:center;gap:10px;padding:18px 24px 10px;flex:none}
.dshg-sheet-body{flex:1;min-height:0;overflow-y:auto;padding:8px 24px 40px;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsw-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.dshg-sheet-inner{max-width:1180px;margin:0 auto;display:flex;flex-direction:column;gap:16px}
.dshg-editor{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:28px;align-items:start}
.dshg-form{display:flex;flex-direction:column;gap:16px;min-width:0}
.dshg-label{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:13px;margin-bottom:6px}
.dshg-field{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:10px 12px;transition:border-color .15s ease}
.dshg-field:focus-within{border-color:var(--dsw-alias-border-l3)}
.dshg-field-invalid{border-color:var(--dsw-alias-label-error)}
.dshg-input{width:100%;border:0;outline:0;background:transparent;font:inherit;color:var(--dsw-alias-label-primary);resize:none}
.dshg-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dshg-textarea{min-height:120px;line-height:22px}
.dshg-error{color:var(--dsw-alias-label-error);font-size:12px;margin-top:6px}
.dshg-knowledge{display:flex;flex-direction:column;gap:8px}
.dshg-knowledge-row{display:flex;align-items:center;gap:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1)}
.dshg-knowledge-name{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshg-knowledge-meta{color:var(--dsw-alias-label-caption);font-size:12px;white-space:nowrap}
.dshg-tag{border-radius:6px;padding:1px 6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-3);white-space:nowrap}
.dshg-check{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dshg-preview{border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1);min-height:420px;padding:20px;display:flex;flex-direction:column;gap:12px;position:sticky;top:0}
.dshg-preview-title{color:var(--dsw-alias-label-secondary);font-size:13px}
.dshg-preview-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;color:var(--dsw-alias-label-secondary)}
.dshg-avatar{display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary)}
.dshg-preview-name{font-size:18px;font-weight:600;line-height:26px}
.dshg-preview-desc{color:var(--dsw-alias-label-secondary);font-size:13px}
.dshg-preview-block{border-top:1px solid var(--dsw-alias-border-l1);padding-top:10px}
.dshg-preview-block-title{color:var(--dsw-alias-label-tertiary);font-size:12px;margin-bottom:4px}
.dshg-preview-body{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:21px;max-height:220px;overflow:auto}
/* Markdown preview: reuse the conversation renderer, but keep it inside the
   card — long code blocks scroll instead of widening the panel. */
.dshg-md{font-size:13px;line-height:21px;max-height:320px;overflow:auto;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}
/* The file viewer gets the dialog's height instead of the preview's cap. */
.dshg-md-tall{max-height:min(56vh, 520px);font-size:13.5px;line-height:22px}
.dshg-md>*:first-child{margin-top:0}
.dshg-md>*:last-child{margin-bottom:0}
.dshg-md h1,.dshg-md h2,.dshg-md h3,.dshg-md h4{margin:10px 0 6px;font-weight:600;line-height:1.4}
.dshg-md h1{font-size:17px}
.dshg-md h2{font-size:15px}
.dshg-md h3{font-size:14px}
.dshg-md p{margin:6px 0}
.dshg-md ul,.dshg-md ol{margin:6px 0;padding-left:20px}
.dshg-md li{margin:2px 0}
.dshg-md code{font-family:var(--dsw-font-markdown-code-font-family, ui-monospace, monospace);font-size:12px;background:var(--dsw-alias-markdown-inline-code);border-radius:4px;padding:1px 4px}
.dshg-md pre{margin:8px 0;padding:10px 12px;border-radius:8px;background:var(--dsw-alias-markdown-code-block);overflow:auto;max-width:100%}
.dshg-md pre code{background:transparent;padding:0;font-size:12px;line-height:1.55}
.dshg-md blockquote{margin:8px 0;padding-left:10px;border-left:2px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary)}
.dshg-md table{border-collapse:collapse;font-size:12px;display:block;overflow:auto;max-width:100%}
.dshg-md th,.dshg-md td{border:1px solid var(--dsw-alias-border-l2);padding:4px 8px}
.dshg-md a{color:var(--dsw-alias-link)}
.dshg-md img{max-width:100%}
.dshg-md hr{border:0;border-top:1px solid var(--dsw-alias-border-l2);margin:10px 0}
.dshg-md-fallback{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:21px;max-height:320px;overflow:auto;color:var(--dsw-alias-label-primary)}
.dshg-preview-list{margin:0;padding-left:16px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px;overflow-wrap:anywhere}
.dshg-note{color:var(--dsw-alias-label-tertiary);font-size:12px}
.dshg-banner{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);padding:8px 12px;color:var(--dsw-alias-label-secondary);font-size:12px}
.dshg-banner-error{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-error)}
.dshg-editor-head{display:flex;align-items:center;gap:10px}
.dshg-back{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dshg-back:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
@media (max-width: 980px){.dshg-editor{grid-template-columns:minmax(0,1fr)}.dshg-preview{position:static}}
/* ── in-conversation skill picker (composer tool row) ─────────────────── */
.dshg-pick{position:relative;display:inline-flex;min-width:0;flex:none}
/* The trigger keeps a fixed ceiling: a long skill name ellipsizes instead of
   pushing the composer's other controls aside. */
.dshg-pick-trigger{display:inline-flex;align-items:center;gap:6px;height:28px;width:auto;max-width:168px;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:0 10px;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);background:transparent;cursor:pointer;overflow:hidden}
.dshg-pick-trigger:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshg-pick-trigger[data-bound=true]{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2)}
.dshg-pick-dot{width:8px;height:8px;border-radius:50%;flex:none}
.dshg-pick-name{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* The popover itself is a transparent frame: the card fan floats directly over
   the conversation, and only the footer is a real surface. Two reasons — the
   cards read as objects in the room rather than cut-outs in a sheet, and the
   upper half stops covering the text the user is about to send. */
/* Anchored to the trigger's centre, not its left edge: the fan is much wider
   than the 168px pill, so left-aligning it made the deck look like it belonged
   to the next control. A translateX(-50%) keeps the deck centred on the pill at
   every width, and the max-width guard keeps it inside the viewport. */
.dshg-pick-menu{position:absolute;bottom:calc(100% + 10px);left:50%;z-index:1200;width:auto;min-width:264px;max-width:min(560px, calc(100vw - 48px));background:transparent;border:0;box-shadow:none;padding:0;transform:translateX(-50%);transform-origin:bottom center;animation:dshg-pop .34s cubic-bezier(.22,1.4,.36,1) both}
/* Deal-in: the deck rises out of the trigger and settles with a slight
   overshoot, while the cards themselves scale up from the pile. Two layers so
   the panel's slide and the cards' growth do not fight each other. */
@keyframes dshg-pop{0%{opacity:0;transform:translateX(-50%) translateY(14px) scale(.9)}60%{opacity:1}100%{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}
@media (prefers-reduced-motion: reduce){.dshg-pick-menu{animation:none}}
/* ── card fan (after Amicro's CardArc5) ──────────────────────────────────
   Five cards overlap at rest and fan out on hover: rotation, horizontal
   spread and a parabola in Y, all driven by distance from the middle card.
   The stage is sized to the RESTING footprint, so the fan can never widen
   the composer's popover; it overflows into the padding instead. */
/* The stage owns an explicit width: every card is absolutely positioned, so
   without it the popover would collapse to the pager's width and the fan would
   spill outside the panel. 232px is the resting five-card fan plus its padding,
   which is also the width the pager centres itself in. */
.dshg-fan{position:relative;display:flex;align-items:flex-end;justify-content:center;width:240px;height:132px;margin:2px auto 4px}
/* Cards carry their own solid surface against the popover's opaque sheet: the
   card is the object of interest here, so it gets the lighter fill, a real rim
   and a shadow that separates it from the panel behind it. */
.dshg-fan-card{position:absolute;bottom:0;left:50%;width:84px;height:118px;margin-left:-42px;display:flex;flex-direction:column;gap:4px;padding:9px 8px;border:1px solid var(--dsw-alias-border-l3);border-radius:13px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;transform-origin:50% 100%;box-shadow:0 6px 14px -4px rgba(15,17,21,.18),0 2px 5px -2px rgba(15,17,21,.12);transition:transform .46s cubic-bezier(.24,1.34,.38,1),box-shadow .3s ease,border-color .2s ease;will-change:transform}
.dshg-fan-card[data-hover=true]{background:var(--dsw-alias-bg-base);border-color:var(--dsw-alias-label-tertiary);box-shadow:0 14px 26px -8px rgba(15,17,21,.28),0 4px 10px -4px rgba(15,17,21,.16)}
.dshg-fan:hover .dshg-fan-card,.dshg-fan:focus-within .dshg-fan-card{box-shadow:0 10px 22px -8px rgba(0,0,0,.28),0 3px 8px -3px rgba(0,0,0,.16)}
.dshg-fan-card:hover{border-color:var(--dsw-alias-border-l3)}
.dshg-fan-card:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color);outline-offset:2px}
.dshg-fan-card[data-active=true]{border-color:var(--dsw-alias-state-business-primary)}
.dshg-fan-avatar{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;font-size:12px;font-weight:500;flex:none}
.dshg-fan-name{font-size:11px;line-height:15px;font-weight:500;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}
/* The description is the card's body copy: clamped to three lines so a long
   one cannot grow the card, and cut at a character boundary in the component so
   the ellipsis lands on a real word rather than mid-glyph. */
.dshg-fan-desc{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:13px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word;flex:none}
.dshg-fan-meta{margin-top:auto;color:var(--dsw-alias-label-caption);font-size:10px;line-height:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshg-fan-badge{position:absolute;top:6px;right:6px;color:var(--dsw-alias-state-business-primary)}
/* ── dealing a card ──────────────────────────────────────────────────────
   Long-press arms a card, dragging lifts it out of the fan, releasing it above
   the threshold plays it — the card flies up and away, which is the gesture's
   confirmation that the skill was chosen. While armed the card stops
   transitioning transforms (the pointer owns them) and grows a little to say it
   is in hand. */
.dshg-fan-card[data-armed=true]{cursor:grabbing;transition:box-shadow .2s ease,border-color .2s ease;box-shadow:0 18px 30px -10px rgba(15,17,21,.34),0 6px 14px -6px rgba(15,17,21,.2);border-color:var(--dsw-alias-label-secondary)}
.dshg-fan-card[data-dealt=true]{pointer-events:none;transition:transform .3s cubic-bezier(.3,.7,.4,1),opacity .3s ease;opacity:0}
/* The whole deck dims while a card is in hand, so the card being dealt is
   unambiguous. */
.dshg-fan[data-dealing=true] .dshg-fan-card:not([data-armed=true]):not([data-dealt=true]){opacity:.5;transition:opacity .2s ease}
@media (prefers-reduced-motion: reduce){.dshg-fan-card[data-dealt=true]{transition:none}}
@media (prefers-reduced-motion: reduce){.dshg-fan-card{transition:none}}
/* ── pager: the only real surface in the popover ─────────────────────────
   The fan floats on transparency; this footer is the one part that needs a
   background, because the arrows and dots have to stay legible over whatever
   the conversation happens to show behind them. */
.dshg-pager{display:flex;align-items:center;justify-content:center;gap:8px;margin:2px auto 0;width:max-content;padding:4px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-base);box-shadow:0 4px 12px -4px rgba(15,17,21,.18)}
.dshg-pager-btn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;transition:background .15s ease,color .15s ease}
.dshg-pager-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshg-pager-btn:disabled{opacity:.35;cursor:default}
.dshg-pager-dots{display:flex;align-items:center;gap:5px}
.dshg-pager-dot{width:5px;height:5px;border:0;padding:0;border-radius:50%;background:var(--dsw-alias-border-l3);cursor:pointer;transition:width .25s cubic-bezier(.22,1,.36,1),background .2s ease}
.dshg-pager-dot[data-on=true]{width:14px;border-radius:3px;background:var(--dsw-alias-label-secondary)}
.dshg-pager-count{color:var(--dsw-alias-label-caption);font-size:10px;line-height:14px;min-width:26px;text-align:center;white-space:nowrap}
/* Group counter sits beside the total, both to the right of the arrows. */
.dshg-pager-sep{width:1px;height:10px;background:var(--dsw-alias-border-l2);flex:none}
.dshg-pick-item{display:flex;align-items:center;gap:8px;width:100%;border:0;border-radius:8px;padding:7px 8px;font:inherit;font-size:13px;line-height:20px;text-align:left;color:var(--dsw-alias-label-primary);background:transparent;cursor:pointer}
.dshg-pick-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshg-pick-item[data-active=true]{background:var(--dsw-alias-interactive-bg-active)}
.dshg-pick-empty{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;max-width:240px;padding:12px;border-radius:12px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);margin:0 auto}
/* "Cancel role" rides the footer pill, so it stays readable on transparency. */
.dshg-pick-clear{display:flex;align-items:center;justify-content:center;gap:6px;width:max-content;margin:6px auto 0;padding:4px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:16px;cursor:pointer}
.dshg-pick-clear:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* ── modal & dialogs ─────────────────────────────────────────────────── */
/* No backdrop-filter here. A full-viewport blur forces the compositor to
   re-rasterise the whole page on open, which showed up as a black flash in
   Electron before the dialog painted. A plain translucent scrim gives the same
   focus without the extra surface. */
.dshg-modal-backdrop{position:fixed;inset:0;background:rgba(15,17,21,0.48);z-index:2200;display:flex;align-items:center;justify-content:center;padding:24px;animation:dshg-scrim-in .14s ease-out both}
@keyframes dshg-scrim-in{from{opacity:0}to{opacity:1}}
/* will-change promotes the dialog to its own layer BEFORE the first paint, so
   the box does not appear a frame late (which read as a flash). */
.dshg-modal-box{background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l3);border-radius:18px;box-shadow:0 20px 40px -8px rgba(0,0,0,.36);max-width:760px;width:100%;max-height:86vh;display:flex;flex-direction:column;overflow:hidden;will-change:transform,opacity;animation:dshg-modal-pop .18s cubic-bezier(.22,1,.36,1) both}
@keyframes dshg-modal-pop{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}
.dshg-modal-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}
.dshg-modal-title{font-size:16px;font-weight:600;display:flex;align-items:center;gap:8px}
.dshg-modal-body{padding:18px 20px;overflow-y:auto;flex:1;min-height:0;display:flex;flex-direction:column;gap:14px}
.dshg-modal-foot{display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:12px 20px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);flex:none}
.dshg-doc-viewer{font-family:var(--dsw-font-markdown-code-font-family, ui-monospace, monospace);font-size:12px;line-height:19px;background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-primary);padding:14px;border-radius:10px;overflow:auto;max-height:min(56vh, 520px);white-space:pre-wrap;word-break:break-all}
/* Viewer mode switch sits above the body, aligned left, and reuses the list's
   segmented control so the two screens feel like one product. */
.dshg-viewer-modes{display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:9px;background:var(--dsw-alias-interactive-bg-hover);margin-bottom:10px}
.dshg-template-grid{display:grid;grid-template-columns:repeat(auto-fill, minmax(320px, 1fr));gap:12px}
.dshg-template-card{border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1);padding:16px;cursor:pointer;text-align:left;transition:all .18s ease;display:flex;flex-direction:column;gap:8px}
.dshg-template-card:hover{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover);box-shadow:var(--dsw-elevation-soft)}
.dshg-template-head{display:flex;align-items:center;justify-content:space-between}
.dshg-template-name{font-weight:600;font-size:14px;color:var(--dsw-alias-label-primary)}
.dshg-template-tag{border-radius:6px;padding:2px 8px;font-size:11px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary)}
.dshg-template-desc{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:18px}
/* ── segments & dropdown ─────────────────────────────────────────────── */
.dshg-seg{display:inline-flex;align-items:center;background:var(--dsw-alias-interactive-bg-hover);border-radius:999px;padding:3px;border:1px solid var(--dsw-alias-border-l1)}
.dshg-seg-btn{border:0;background:transparent;padding:4px 14px;font:inherit;font-size:13px;font-weight:500;color:var(--dsw-alias-label-secondary);border-radius:999px;cursor:pointer;transition:all .15s ease}
.dshg-seg-btn:hover{color:var(--dsw-alias-label-primary)}
.dshg-seg-btn[data-active=true]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 1px 4px rgba(0,0,0,.14)}
.dshg-dropdown{position:relative;display:inline-flex}
/* Its own entrance, not the picker's dshg-pop: that keyframe carries a
   translateX(-50%) for the centred popover, and reusing it here made the
   right-aligned menu fly in from the left before settling. This one grows out
   of the button's own corner — no horizontal travel at all. */
.dshg-dropdown-menu{position:absolute;top:calc(100% + 6px);right:0;z-index:1000;min-width:140px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l3);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.22);padding:5px;display:flex;flex-direction:column;gap:3px;transform-origin:top right;animation:dshg-menu-pop .16s cubic-bezier(.22,1,.36,1) both}
@keyframes dshg-menu-pop{from{opacity:0;transform:translateY(-4px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
@media (prefers-reduced-motion: reduce){.dshg-dropdown-menu{animation:none}}
.dshg-dropdown-item{display:flex;align-items:center;gap:8px;border:0;background:transparent;width:100%;padding:8px 10px;border-radius:8px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer}
.dshg-dropdown-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshg-pager-toggle{display:inline-flex;align-items:center;gap:4px;border:0;border-radius:999px;padding:3px 8px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-size:11px;font-weight:500;line-height:16px;cursor:pointer;transition:background .15s ease}
.dshg-pager-toggle:hover{background:var(--dsw-alias-interactive-bg-active)}
`;

    const tagId = 'dsh-gen/DshGen.module.css';
    const injectStyles = () => {
      if (typeof document === 'undefined') return { remove() {} };
      const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`);
      if (existing !== null) return existing;
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-gen';
      tag.dataset.pluginCss = tagId;
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return tag;
    };

    /* ── small helpers ──────────────────────────────────────────────────── */
    const unwrap = (raw) => {
      if (raw !== null && typeof raw === 'object' && raw.ok === false) {
        const failure = raw.error;
        const code = failure !== null && typeof failure === 'object' && typeof failure.code === 'string' ? failure.code : 'gateway';
        const message = failure !== null && typeof failure === 'object' && typeof failure.message === 'string' ? `: ${failure.message}` : '';
        throw new Error(`${code}${message}`);
      }
      const value = raw !== null && typeof raw === 'object' && raw.ok === true ? raw.value : raw;
      if (value !== null && typeof value === 'object' && typeof value.error === 'string') throw new Error(value.error);
      return value;
    };

    const bytesText = (bytes) => {
      if (!Number.isFinite(bytes) || bytes <= 0) return '空文件';
      if (bytes < 1024) return `${bytes} 字节`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    };

    const timeText = (iso) => {
      if (typeof iso !== 'string' || iso === '') return '';
      const at = new Date(iso);
      if (Number.isNaN(at.getTime())) return '';
      const pad = (n) => String(n).padStart(2, '0');
      return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
    };

    const readFileBase64 = (file) =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error(`读取「${file.name}」失败`));
        reader.onload = () => {
          const result = typeof reader.result === 'string' ? reader.result : '';
          const comma = result.indexOf(',');
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.readAsDataURL(file);
      });

    const emptyDraft = (kind = 'skill') => ({
      id: undefined,
      kind,
      name: '',
      description: '',
      instructions: '',
      disableKnowledge: kind === 'preset',
      knowledge: [],
      /** Files picked in this editor session, uploaded with the next 保存. */
      pendingFiles: [],
      /** Ids of saved knowledge files removed in this session. */
      removedKnowledgeIds: [],
      /** Derived: saved files minus the removed ones, plus the pending ones. */
      visibleKnowledge: [],
      createdAt: undefined,
      updatedAt: undefined,
    });

    const draftOf = (gen) => {
      const knowledge = Array.isArray(gen.knowledge) ? gen.knowledge.slice() : [];
      const kind = gen?.kind === 'preset' ? 'preset' : 'skill';
      return {
        id: gen.id,
        kind,
        name: gen.name ?? '',
        description: gen.description ?? '',
        instructions: gen.instructions ?? '',
        disableKnowledge: kind === 'preset' ? true : gen.disableKnowledge === true,
        knowledge,
        pendingFiles: [],
        removedKnowledgeIds: [],
        visibleKnowledge: knowledge.slice(),
        createdAt: gen.createdAt,
        updatedAt: gen.updatedAt,
      };
    };

    /** Recompute the rows the knowledge section shows after any draft change. */
    const withVisibleKnowledge = (draft) => {
      const removed = new Set(draft.removedKnowledgeIds ?? []);
      const saved = (draft.knowledge ?? []).filter((item) => !removed.has(item.id));
      const pending = (draft.pendingFiles ?? []).map((file) => ({
        key: file.key,
        name: file.name,
        bytes: file.bytes,
        pending: true,
      }));
      return { ...draft, visibleKnowledge: [...saved, ...pending] };
    };

    /**
     * Put a preset's prompt into the composer.
     *
     * Two paths, in order of reliability:
     *
     *   1. `ctx.conversation.input.setDraft` — the Session's own draft store. This
     *      is what the composer renders from, so the text survives re-renders and
     *      participates in undo exactly like typed input. Preferred whenever the
     *      Session binding is reachable.
     *   2. A DOM write against the live `<textarea>` / contenteditable, using the
     *      native value setter so React's controlled input notices the change.
     *      Kept as a fallback for compositions where the conversation service is
     *      not injectable from this scope.
     *
     * Returns true when the text landed somewhere.
     */
    const insertPromptIntoComposer = (text, conversationInput) => {
      const prompt = typeof text === 'string' ? text.trim() : '';
      if (prompt === '') return false;

      // 1. Official draft API.
      try {
        if (conversationInput !== undefined && typeof conversationInput.setDraft === 'function') {
          conversationInput.setDraft(prompt);
          return true;
        }
      } catch {
        /* fall through to the DOM path */
      }

      // 2. DOM fallback.
      const selectors = [
        'textarea[data-testid="chat-input"]',
        '.dsh-composer textarea',
        '.composer-input textarea',
        '.chat-composer textarea',
        'textarea[placeholder*="输入"]',
        'textarea[placeholder*="Message"]',
        'textarea[placeholder*="Send"]',
        'div[contenteditable="true"]',
        'textarea',
      ];
      let targetEl = null;
      for (const sel of selectors) {
        const els = Array.from(document.querySelectorAll(sel));
        const visible = els.find((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && !el.closest('.dshg-sheet') && !el.closest('.dshg-pick');
        });
        if (visible !== undefined) {
          targetEl = visible;
          break;
        }
      }
      if (targetEl === null) return false;

      if (targetEl.tagName === 'TEXTAREA' || targetEl.tagName === 'INPUT') {
        const proto = targetEl.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter === undefined) return false;
        setter.call(targetEl, prompt);
        targetEl.dispatchEvent(new Event('input', { bubbles: true }));
        targetEl.dispatchEvent(new Event('change', { bubbles: true }));
        targetEl.focus();
        targetEl.selectionStart = targetEl.selectionEnd = prompt.length;
        return true;
      }
      if (targetEl.isContentEditable) {
        targetEl.focus();
        // Select-all first: a preset replaces the draft rather than appending to
        // whatever half-typed sentence was there.
        const range = document.createRange();
        range.selectNodeContents(targetEl);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.execCommand('insertText', false, prompt);
        return true;
      }
      return false;
    };

    const Icon = ({ name, size = 16, ...rest }) => {
      const component = primitives[name];
      return component === undefined ? null : h(component, { size, ...rest });
    };

    /**
     * QingIcon (https://qingicon.com, MIT) paths, embedded so the plugin needs no
     * network and no icon dependency. All of them share one 24×24 canvas, a 2px
     * stroke, round caps and round joins — drawing them from one table is what
     * keeps the row's four controls visually consistent.
     */
    const QING_PATHS = {
      chat: 'M9 9H15M9 13H13M3.5 4H20.5V18H15L12 21L9 18H3.5V4Z',
      pencil: 'M17.3301 12.3301L11.6719 6.67188M15.7427 2.60046L21.3995 8.25732L9.15685 20.5L3.5 20.5L3.5 14.8431L15.7427 2.60046Z',
      trash: 'M16 7L15 3H9L8 7M3 7L21 7M19 7L17.5 20.5H6.5L5 7',
      eye:
        'M12 5C4 5 2 12 2 12C2 12 4 19 12 19C20 19 22 12 22 12C22 12 20 5 12 5Z' +
        'M15 12C15 13.6569 13.6569 15 12 15C10.3431 15 9 13.6569 9 12C9 10.3431 10.3431 9 12 9C13.6569 9 15 10.3431 15 12Z',
      eyeOff:
        'M6.43792 6.43556C3.00463 8.48381 2 12 2 12C2 12 4 19 12 19C14.3314 19 16.1532 18.4055 17.5644 17.5631' +
        'M10.7219 5.06238C11.1299 5.02159 11.5557 5 12 5C20 5 22 12 22 12C22 12 21.616 13.3441 20.5113 14.8544' +
        'M9.87868 9.87869C9.33579 10.4216 9 11.1716 9 12C9 13.6569 10.3431 15 12 15C12.8284 15 13.5784 14.6642 14.1213 14.1213' +
        'M20 20L4 4',
      chevronDown: 'M6 9L12 15L18 9',
      chevronLeft: 'M15 6L9 12L15 18',
      chevronRight: 'M9 6L15 12L9 18',
      arrowLeft: 'M3 12H21M10 19L3 12L10 5',
      arrowRight: 'M3 12H21M14 19L21 12L14 5',
      close: 'M6 6L18 18M18 6L6 18',
      check: 'M4 12.5L9.5 18L20 6',
      plus: 'M12 4V20M4 12H20',
      sparkle:
        'M12 3L13.9 9.1L20 11L13.9 12.9L12 19L10.1 12.9L4 11L10.1 9.1L12 3Z',
      copy: 'M8 4H18C19.1046 4 20 4.89543 20 6V16M4 8H14C15.1046 8 16 8.89543 16 10V20C16 21.1046 15.1046 22 14 22H6C4.89543 22 4 21.1046 4 20V10C4 8.89543 4.89543 8 6 8Z',
      download: 'M12 3V15M12 15L7 10M12 15L17 10M4 19H20',
      upload: 'M12 15V3M12 3L7 8M12 3L17 8M4 19H20',
      fileText: 'M14 3H6C4.89543 3 4 3.89543 4 5V19C4 20.1046 4.89543 21 6 21H18C19.1046 21 20 20.1046 20 19V9L14 3ZM14 3V9H20M8 13H16M8 17H13',
      template: 'M4 4H10V10H4V4ZM14 4H20V10H14V4ZM4 14H10V20H4V14ZM14 14H20V20H14V14Z',
    };

    /**
     * One line icon on the shared 24-grid. `stroke` stays `currentColor` so the
     * glyph inherits its button's colour, including hover and disabled states.
     */
    const QIcon = ({ name, size = 16, strokeWidth = 2, ...rest }) => {
      const d = QING_PATHS[name];
      if (d === undefined) return null;
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
          ...rest,
        },
        h('path', { d }),
      );
    };

    /* ── skill presets ─────────────────────────────────────────────────── */
    const SKILL_PRESETS = [
      {
        id: 'code-reviewer',
        name: '代码审查规范官',
        tag: '工程质量',
        description: '针对提交的代码变更，从严谨性、边界条件、性能隐患与架构规范开展深度代码审查。',
        instructions: `你是一位具备资深技术背景的代码审查架构师。你的目标是对用户提交的代码片段或项目补丁进行专业、严密的审查，识别潜在隐患并提供高质量修改建议。

## 审查维度
1. **正确性与边界条件**：检查边界空值、越界、并发竞态、异步时序问题，确保逻辑在极端情况下稳健。
2. **异常与容错能力**：审查是否处理了可能的拒绝、断网或异常报错，确保错误信息友好且无未捕获异常。
3. **性能与资源控制**：检查是否存在内存泄漏隐患、不必要的高频重绘或重复计算、未释放的句柄与监听器。
4. **架构与可读性**：遵循单一职责原则，变量与函数命名精准传达意图，消除冗余代码。
5. **类型安全与规范**：检查类型推导、空安全以及代码风格统一性。

## 输出结构
- **总体评价**：简明扼要指出代码质量与主要风险点。
- **重点隐患清单**：按严重级别（高/中/低）列举问题位置与成因。
- **重构改进方案**：给出前后对比或完整的修补代码示例。`,
      },
      {
        id: 'tech-architect',
        name: '技术架构评估师',
        tag: '系统架构',
        description: '对系统技术选型、微服务解耦、高可用演进与数据一致性方案进行架构评审。',
        instructions: `你是一位专注于大型分布式系统与企业级应用的技术架构评估师。你善于运用第一性原理与权衡分析（Trade-offs），为复杂的系统设计把关。

## 核心职责
1. **需求与场景解构**：澄清系统的核心业务指标（并发规模、数据吞吐量、读写比、SLA 要求）。
2. **架构权衡分析**：对比不同技术选型在性能、复杂度、运维成本及团队心智负担上的优缺点。
3. **瓶颈与单点诊断**：发现系统中的单点故障（SPOF）、慢查询瓶颈、缓存雪崩与一致性隐患。
4. **降级与容灾设计**：制定限流熔断、平滑降级、冷备与跨可用区容灾策略。

## 回答原则
- 绝不空谈概念，建议紧贴业务发展阶段与工程实际成本。
- 提供清晰的架构时序图或模块划分示意图（ASCII / Markdown 表格）。`,
      },
      {
        id: 'tech-writer',
        name: '技术文档撰写员',
        tag: '技术写作',
        description: '将复杂系统逻辑与 API 接口转化为清晰易懂、层次严密的技术文档与集成指南。',
        instructions: `你是一位专业的技术写作专家，擅长将复杂的工程实现、协议细节与 API 规范转化为逻辑清晰、排版优雅的开发者文档。

## 撰写准则
1. **结构清晰**：先说明背景与解决的核心问题，再展开安装、快速开始、参数详解与高级配置。
2. **示例完整**：所有代码示例必须可直接运行，涵盖请求与响应样例、常见错误状态码与排错指引。
3. **文风严谨克制**：用词准确规范，避免口语化或含糊其辞，使用标准 Markdown 格式排版。
4. **前置条件与依赖明确**：清楚注明环境要求、版本兼容性与权限前置。`,
      },
      {
        id: 'troubleshooter',
        name: '问题排查与根因分析专家',
        tag: '故障诊断',
        description: '基于堆栈报错、错误日志与链路监控，推导复现路径并定位系统根本原因。',
        instructions: `你是一位擅长高难度系统故障诊断与性能调优的排查专家。你遵循“现象分析 - 假设推导 - 验证定位 - 根因治理”的排查模型。

## 诊断步骤
1. **现象确认与影响面评估**：梳理错误日志堆栈、触发频率、受影响环境与业务范围。
2. **根本原因推导（5-Whys）**：穿透表面错误，追溯至配置错误、并发时序冲突、网络抖动或底层依赖 Bug。
3. **紧急止血措施（Workaround）**：第一时间提供能快速恢复服务、控制故障损失的临时缓解方案。
4. **长期根治与防范机制**：提出防患于未然的监控告警阈值、代码防御性重构及复盘整改项。`,
      },
      {
        id: 'data-cleanser',
        name: '数据清洗与转换顾问',
        tag: '数据处理',
        description: '处理复杂异构数据清洗、字段映射校验、JSON 与表格结构化转换。',
        instructions: `你是一位经验丰富的数据工程师，精通各种格式（JSON、CSV、SQL、Markdown）的数据结构化梳理与清洗规范。

## 处理能力
1. **结构规范化**：将混乱无序的半结构化文本提取并重组为整齐的标准格式。
2. **脏数据治理**：自动识别缺失值、重复项、时间戳时区偏差、非法字符并提供补全与过滤规则。
3. **映射与转换**：输出准确的字段映射字典、数据类型转换逻辑（Type Casting）及校验模式（Schema）。
4. **幂等性与批处理**：给出适合规模化处理的脚本代码（如 Python / Node.js），保证数据转换的可重复验证。`,
      },
    ];

    /* ── document viewer modal ─────────────────────────────────────────── */
    /**
     * Body of the file viewer: Markdown by default, with a toggle to the raw
     * source. Rendered through the same `MarkdownBlock` the editor preview uses,
     * so a knowledge document reads exactly like it will in the conversation —
     * which is the point of looking at it here at all. Files whose name is not a
     * Markdown extension still get the renderer (plain prose is valid Markdown)
     * but open in source mode, where indentation and line breaks are literal.
     */
    const ViewerBody = ({ detail }) => {
      const content = detail?.content ?? '';
      const fileName = detail?.fileName ?? '';
      const markdownLike = /\.(md|markdown|mdx|txt)$/i.test(fileName);
      const [mode, setMode] = useState(markdownLike ? 'preview' : 'source');
      if (content === '') return h('div', { className: 'dshg-note' }, '（文件内容为空）');
      return h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'dshg-viewer-modes' },
          h(
            'button',
            {
              type: 'button',
              className: 'dshg-seg-btn',
              'data-active': mode === 'preview' ? 'true' : 'false',
              onClick: () => setMode('preview'),
            },
            '预览',
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dshg-seg-btn',
              'data-active': mode === 'source' ? 'true' : 'false',
              onClick: () => setMode('source'),
            },
            '源码',
          ),
        ),
        mode === 'preview'
          ? h(MarkdownBlock, { text: content, tall: true })
          : h('pre', { className: 'dshg-doc-viewer' }, content),
      );
    };

    const FileViewerModal = ({ file, genId, api, onClose }) => {
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState('');
      const [copied, setCopied] = useState(false);
      const [detail, setDetail] = useState(null);

      useEffect(() => {
        const onKeyDown = (e) => {
          if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
      }, [onClose]);

      useEffect(() => {
        let canceled = false;
        const loadContent = async () => {
          setLoading(true);
          setError('');
          try {
            if (file.pending === true && typeof file.data === 'string') {
              try {
                const raw = atob(file.data);
                if (!canceled) {
                  setDetail({
                    fileName: file.name,
                    name: file.name,
                    bytes: file.bytes,
                    isBinary: false,
                    truncated: false,
                    content: raw,
                  });
                }
              } catch {
                if (!canceled) {
                  setDetail({
                    fileName: file.name,
                    name: file.name,
                    bytes: file.bytes,
                    isBinary: true,
                    truncated: false,
                    content: '',
                  });
                }
              }
            } else if (api !== undefined && genId !== undefined) {
              const res = unwrap(await api.readKnowledgeFile({ id: genId, fileId: file.id }));
              if (!canceled) setDetail(res);
            } else {
              throw new Error('无法读取文件内容');
            }
          } catch (err) {
            if (!canceled) setError(String(err?.message ?? err));
          } finally {
            if (!canceled) setLoading(false);
          }
        };
        void loadContent();
        return () => {
          canceled = true;
        };
      }, [file, genId, api]);

      const copy = () => {
        if (!detail?.content) return;
        navigator.clipboard?.writeText(detail.content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      };

      return h(
        'div',
        { className: 'dshg-modal-backdrop', onClick: onClose },
        h(
          'div',
          { className: 'dshg-modal-box', onClick: (e) => e.stopPropagation() },
          h(
            'div',
            { className: 'dshg-modal-head' },
            h(
              'div',
              { className: 'dshg-modal-title' },
              h(QIcon, { name: 'fileText', size: 18 }),
              file.name,
            ),
            h(
              'button',
              { type: 'button', className: 'dshg-icon-btn', onClick: onClose, title: '关闭' },
              h(QIcon, { name: 'close', size: 16 }),
            ),
          ),
          h(
            'div',
            { className: 'dshg-modal-body' },
            loading
              ? h('div', { className: 'dshg-note' }, '正在读取文件内容…')
              : error !== ''
              ? h('div', { className: 'dshg-banner dshg-banner-error' }, error)
              : detail?.isBinary
              ? h('div', { className: 'dshg-note' }, '该文件为二进制文件或非纯文本格式，不支持在线文本预览。模型在对话时会按需通过文件绝对路径直接调用系统工具读取。')
              : h(
                  React.Fragment,
                  null,
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
                    h(
                      'span',
                      { className: 'dshg-note' },
                      `文件大小：${bytesText(detail.bytes)}${detail.truncated ? '（已预览前 128KB 文本）' : ''}`,
                    ),
                    h(
                      'button',
                      { type: 'button', className: 'dshg-ghost', onClick: copy },
                      h(QIcon, { name: copied ? 'check' : 'copy', size: 14 }),
                      copied ? '已复制' : '复制全文',
                    ),
                  ),
                  h(ViewerBody, { detail }),
                ),
          ),
          h(
            'div',
            { className: 'dshg-modal-foot' },
            h(
              'button',
              { type: 'button', className: 'dshg-primary', onClick: onClose },
              '关闭',
            ),
          ),
        ),
      );
    };

    /* ── template picker modal ─────────────────────────────────────────── */
    const TemplatePickerModal = ({ onSelect, onClose }) => {
      useEffect(() => {
        const onKeyDown = (e) => {
          if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
      }, [onClose]);

      return h(
        'div',
        { className: 'dshg-modal-backdrop', onClick: onClose },
        h(
          'div',
          { className: 'dshg-modal-box', onClick: (e) => e.stopPropagation() },
          h(
            'div',
            { className: 'dshg-modal-head' },
            h(
              'div',
              { className: 'dshg-modal-title' },
              h(QIcon, { name: 'template', size: 18 }),
              '选择技能预设模板',
            ),
            h(
              'button',
              { type: 'button', className: 'dshg-icon-btn', onClick: onClose, title: '关闭' },
              h(QIcon, { name: 'close', size: 16 }),
            ),
          ),
          h(
            'div',
            { className: 'dshg-modal-body' },
            h('div', { className: 'dshg-note' }, '从内置经典模板快速初始化技能设定，你可以在此基础上做进一步补充与微调。'),
            h(
              'div',
              { className: 'dshg-template-grid' },
              SKILL_PRESETS.map((preset) =>
                h(
                  'div',
                  {
                    key: preset.id,
                    className: 'dshg-template-card',
                    onClick: () => onSelect(preset),
                  },
                  h(
                    'div',
                    { className: 'dshg-template-head' },
                    h('span', { className: 'dshg-template-name' }, preset.name),
                    h('span', { className: 'dshg-template-tag' }, preset.tag),
                  ),
                  h('div', { className: 'dshg-template-desc' }, preset.description),
                ),
              ),
            ),
          ),
          h(
            'div',
            { className: 'dshg-modal-foot' },
            h(
              'button',
              { type: 'button', className: 'dshg-ghost', onClick: onClose },
              '取消',
            ),
          ),
        ),
      );
    };

    /**
     * Markdown body shared by the editor preview and the file viewer. The
     * primitives' `MarkdownText` is the same renderer the conversation uses, so
     * headings, lists, code fences and tables look exactly as the model sees
     * them. It is wrapped in a boundary: a renderer failure degrades to raw text
     * instead of taking the whole page down.
     *
     * `tall` swaps the preview's 320px cap for the viewer's taller box; the
     * renderer and the typography stay identical either way.
     */
    const MarkdownBlock = ({ text, tall = false }) => {
      const [failed, setFailed] = React.useState(false);
      const Renderer = primitives.MarkdownText;
      React.useEffect(() => {
        setFailed(false);
      }, [text]);
      const className = tall ? 'dshg-md dshg-md-tall' : 'dshg-md';
      const fallbackClass = tall ? 'dshg-md-fallback dshg-md-tall' : 'dshg-md-fallback';
      if (Renderer === undefined || failed) {
        return h('div', { className: fallbackClass }, text);
      }
      try {
        return h(
          'div',
          { className },
          h(ErrorBoundary, { onError: () => setFailed(true), resetKey: text },
            h(Renderer, { text, labels: { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '' } }),
          ),
        );
      } catch {
        return h('div', { className: fallbackClass }, text);
      }
    };

    /** Minimal error boundary so one bad Markdown node cannot blank the page. */
    class ErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { failed: false };
      }

      static getDerivedStateFromError() {
        return { failed: true };
      }

      componentDidCatch() {
        this.props.onError?.();
      }

      componentDidUpdate(previous) {
        if (previous.resetKey !== this.props.resetKey && this.state.failed) {
          this.setState({ failed: false });
        }
      }

      render() {
        if (this.state.failed) return h('div', { className: 'dshg-md-fallback' }, this.props.children);
        return this.props.children;
      }
    }

    /**
     * Row-card avatar: the first character of the name over one of a small set of
     * soft tints, picked deterministically from the name so a skill keeps the
     * same colour between reloads.
     */
    const AVATAR_TINTS = [
      { bg: '#f7d6dd', fg: '#8f3a4c' },
      { bg: '#dcdcf7', fg: '#4b4b96' },
      { bg: '#d6ecdf', fg: '#2f6b48' },
      { bg: '#f9e4c8', fg: '#8a5a20' },
      { bg: '#d8e8f7', fg: '#2f5d86' },
      { bg: '#efdcf2', fg: '#6f3a7a' },
    ];
    const tintOf = (name) => {
      let hash = 0;
      for (const char of String(name ?? '')) hash = (hash * 31 + char.codePointAt(0)) % 100000;
      return AVATAR_TINTS[hash % AVATAR_TINTS.length];
    };
    const avatarText = (name) => {
      const trimmed = String(name ?? '').trim();
      if (trimmed === '') return '技';
      const first = [...trimmed][0];
      return first.toUpperCase();
    };
    const avatarStyle = (name) => {
      const tint = tintOf(name);
      return { background: tint.bg, color: tint.fg };
    };

    /* ── preview ────────────────────────────────────────────────────────── */
    const Preview = ({ draft }) => {
      const named = draft.name.trim() !== '';
      return h(
        'aside',
        { className: 'dshg-preview', 'aria-live': 'polite' },
        h('div', { className: 'dshg-preview-title' }, '预览'),
        named
          ? h(
              React.Fragment,
              null,
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 12 } },
                h('span', { className: 'dshg-avatar' }, h(Icon, { name: 'IconSparkleRegular', size: 24 })),
                h(
                  'div',
                  { style: { minWidth: 0 } },
                  h('div', { className: 'dshg-preview-name' }, draft.name.trim()),
                  draft.description.trim() === ''
                    ? null
                    : h('div', { className: 'dshg-preview-desc' }, draft.description.trim()),
                ),
              ),
              h(
                'div',
                { className: 'dshg-preview-block' },
                h('div', { className: 'dshg-preview-block-title' }, '指令'),
                draft.instructions.trim() === ''
                  ? h('div', { className: 'dshg-note' }, '（未填写指令）')
                  : h(MarkdownBlock, { text: draft.instructions }),
              ),
              h(
                'div',
                { className: 'dshg-preview-block' },
                h('div', { className: 'dshg-preview-block-title' }, '知识'),
                draft.disableKnowledge
                  ? h('div', { className: 'dshg-note' }, '已停用知识引用')
                  : draft.visibleKnowledge.length === 0
                    ? h('div', { className: 'dshg-note' }, '没有挂载文件')
                    : h(
                        'ul',
                        { className: 'dshg-preview-list' },
                        draft.visibleKnowledge.map((item) =>
                          h('li', { key: item.key ?? item.id }, `${item.name} · ${bytesText(item.bytes)}`),
                        ),
                      ),
              ),
            )
          : h(
              'div',
              { className: 'dshg-preview-empty' },
              h('span', { className: 'dshg-avatar' }, h(Icon, { name: 'IconSparkleRegular', size: 24 })),
              h('div', null, '为技能命名后才能预览'),
            ),
      );
    };

    /* ── editor ─────────────────────────────────────────────────────────── */
    const Editor = ({ api, draft, onChange, onSaved, onCancel }) => {
      const [busy, setBusy] = useState('');
      const [error, setError] = useState('');
      const [touched, setTouched] = useState(false);
      const [viewingFile, setViewingFile] = useState(null);
      const [pickingTemplate, setPickingTemplate] = useState(false);
      const inputRef = useRef(null);
      const nameMissing = draft.name.trim() === '';

      useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key === 'Escape' && busy === '' && viewingFile === null && !pickingTemplate) onCancel();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
      }, [busy, onCancel, viewingFile, pickingTemplate]);

      const pickFiles = () => {
        if (inputRef.current !== null) inputRef.current.click();
      };

      const applyPreset = (preset) => {
        const hasContent = draft.name.trim() !== '' || draft.instructions.trim() !== '';
        if (hasContent && typeof window !== 'undefined' && !window.confirm(`应用模板「${preset.name}」将覆盖当前表单中的名称、说明与指令，是否继续？`)) {
          return;
        }
        onChange({
          name: preset.name,
          description: preset.description,
          instructions: preset.instructions,
        });
        setPickingTemplate(false);
      };

      const onFiles = async (event) => {
        const files = [...(event.target.files ?? [])];
        event.target.value = '';
        if (files.length === 0) return;
        setBusy('upload');
        setError('');
        try {
          // Knowledge is part of the draft, not a post-save step: the files ride
          // the next 保存 together with the name/description/instructions.
          const pending = [];
          for (const file of files) {
            pending.push({
              key: `pending_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
              name: file.name,
              bytes: file.size,
              data: await readFileBase64(file),
            });
          }
          onChange({ pendingFiles: [...(draft.pendingFiles ?? []), ...pending] });
        } catch (reason) {
          setError(String(reason?.message ?? reason));
        } finally {
          setBusy('');
        }
      };

      const removeFile = (item) => {
        if (item.pending === true) {
          onChange({ pendingFiles: (draft.pendingFiles ?? []).filter((file) => file.key !== item.key) });
          return;
        }
        onChange({ removedKnowledgeIds: [...(draft.removedKnowledgeIds ?? []), item.id] });
      };

      const save = async () => {
        setTouched(true);
        if (nameMissing) return;
        setBusy('save');
        setError('');
        try {
          const view = unwrap(
            await api.saveGen({
              id: draft.id,
              kind: 'skill',
              name: draft.name.trim(),
              description: draft.description,
              instructions: draft.instructions,
              disableKnowledge: draft.disableKnowledge,
              files: (draft.pendingFiles ?? []).map((file) => ({ name: file.name, data: file.data })),
              removedKnowledgeIds: draft.removedKnowledgeIds ?? [],
            }),
          );
          onSaved(view, { keepEditing: false, kind: 'skill' });
        } catch (reason) {
          setError(String(reason?.message ?? reason));
        } finally {
          setBusy('');
        }
      };

      return h(
        'div',
        { className: 'dshg-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': '编辑技能' },
        h(
          'div',
          { className: 'dshg-sheet-head' },
          h(
            'button',
            { type: 'button', className: 'dshg-back', onClick: onCancel, title: '返回技能列表', 'aria-label': '返回技能列表' },
            h(Icon, { name: 'IconChevronLeftOutlineRegular', size: 18 }),
          ),
          h('span', { className: 'dshg-avatar', style: { width: 40, height: 40 } }, h(Icon, { name: 'IconSparkleRegular', size: 20 })),
          h('div', { className: 'dshg-head-title', style: { fontSize: 16 } }, draft.name.trim() === '' ? '新建技能' : draft.name.trim()),
          h('span', { className: 'dshg-grow' }),
          h(
            'button',
            {
              type: 'button',
              className: 'dshg-ghost',
              onClick: () => setPickingTemplate(true),
              title: '选择内置预设模板',
            },
            h(QIcon, { name: 'template', size: 15 }),
            '从模板选择',
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dshg-primary',
              disabled: busy !== '' || nameMissing,
              onClick: save,
            },
            busy === 'save' ? '保存中…' : '保存',
          ),
        ),
        h(
          'div',
          { className: 'dshg-sheet-body' },
          h(
            'div',
            { className: 'dshg-sheet-inner' },
            error === '' ? null : h('div', { className: 'dshg-banner dshg-banner-error' }, error),
            h(
              'div',
              { className: 'dshg-editor' },
              h(
                'div',
                { className: 'dshg-form' },
                h(
                  'div',
                  null,
                  h('div', { className: 'dshg-label' }, '名称'),
                  h(
                    'div',
                    { className: `dshg-field${touched && nameMissing ? ' dshg-field-invalid' : ''}` },
                    h('input', {
                      className: 'dshg-input',
                      value: draft.name,
                      placeholder: '为你的技能命名',
                      onChange: (event) => onChange({ name: event.target.value }),
                      onBlur: () => setTouched(true),
                    }),
                  ),
                  touched && nameMissing
                    ? h('div', { className: 'dshg-error' }, '你需要为技能命名，然后才能保存。')
                    : null,
                ),
                h(
                  'div',
                  null,
                  h('div', { className: 'dshg-label' }, '说明'),
                  h(
                    'div',
                    { className: 'dshg-field' },
                    h('textarea', {
                      className: 'dshg-input',
                      rows: 2,
                      value: draft.description,
                      placeholder: '介绍你的技能并说明它的用途',
                      onChange: (event) => onChange({ description: event.target.value }),
                    }),
                  ),
                ),
                h(
                  'div',
                  null,
                  h('div', { className: 'dshg-label' }, '指令'),
                  h(
                    'div',
                    { className: 'dshg-field' },
                    h('textarea', {
                      className: 'dshg-input dshg-textarea',
                      rows: 6,
                      value: draft.instructions,
                      placeholder:
                        '例如：你是一位架构师，熟悉分布式高并发系统设计。你需要考虑可伸缩性、容灾降级及数据一致性。你逻辑严密、专业务实。',
                      onChange: (event) => onChange({ instructions: event.target.value }),
                    }),
                  ),
                ),
                h(
                  'div',
                  null,
                  h('div', { className: 'dshg-label' }, '知识'),
                  h(
                    'div',
                    { className: 'dshg-knowledge' },
                    h(
                      'div',
                      { className: 'dshg-field', style: { display: 'flex', alignItems: 'center', gap: 8 } },
                      h(
                        'span',
                        { className: 'dshg-grow', style: { color: 'var(--dsw-alias-label-tertiary)' } },
                        '添加文件，供你的技能在对话中参考。',
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dshg-icon-btn',
                          title: '添加文件',
                          'aria-label': '添加文件',
                          disabled: busy !== '',
                          onClick: pickFiles,
                        },
                        h(Icon, { name: 'IconPlusOutlineRegular', size: 16 }),
                      ),
                      h('input', {
                        ref: inputRef,
                        type: 'file',
                        multiple: true,
                        style: { display: 'none' },
                        onChange: onFiles,
                      }),
                    ),
                    draft.visibleKnowledge.length === 0
                      ? null
                      : draft.visibleKnowledge.map((item) =>
                          h(
                            'div',
                            { className: 'dshg-knowledge-row', key: item.key ?? item.id },
                            h(Icon, { name: 'IconDeliverDocRegular', size: 16 }),
                            h(
                              'span',
                              { className: 'dshg-knowledge-name dshg-grow', title: item.pending === true ? item.name : item.path },
                              item.name,
                            ),
                            item.pending === true ? h('span', { className: 'dshg-tag' }, '待保存') : null,
                            h('span', { className: 'dshg-knowledge-meta' }, bytesText(item.bytes)),
                            h(
                              'button',
                              {
                                type: 'button',
                                className: 'dshg-icon-btn',
                                title: '查看文件内容',
                                'aria-label': `查看 ${item.name}`,
                                onClick: () => setViewingFile(item),
                              },
                              h(QIcon, { name: 'fileText', size: 15 }),
                            ),
                            h(
                              'button',
                              {
                                type: 'button',
                                className: 'dshg-icon-btn dshg-danger',
                                title: '移除',
                                'aria-label': `移除 ${item.name}`,
                                disabled: busy !== '',
                                onClick: () => removeFile(item),
                              },
                              h(Icon, { name: 'IconCloseOutlineRegular', size: 14 }),
                            ),
                          ),
                        ),
                  ),
                ),
                h(
                  'label',
                  { className: 'dshg-check' },
                  h('input', {
                    type: 'checkbox',
                    checked: draft.disableKnowledge,
                    onChange: (event) => onChange({ disableKnowledge: event.target.checked }),
                  }),
                  h('span', null, '停用知识引用'),
                ),
              ),
              h(Preview, { draft }),
            ),
          ),
        ),
        viewingFile !== null
          ? h(FileViewerModal, {
              file: viewingFile,
              genId: draft.id,
              api,
              onClose: () => setViewingFile(null),
            })
          : null,
        pickingTemplate
          ? h(TemplatePickerModal, {
              onSelect: applyPreset,
              onClose: () => setPickingTemplate(false),
            })
          : null,
      );
    };

    /* ── preset editor (clean & minimal: name + content) ────────────────── */
    const PresetEditor = ({ api, draft, onChange, onSaved, onCancel }) => {
      const [busy, setBusy] = useState('');
      const [error, setError] = useState('');
      const [touched, setTouched] = useState(false);
      const nameMissing = draft.name.trim() === '';

      useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key === 'Escape' && busy === '') onCancel();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
      }, [busy, onCancel]);

      const save = async () => {
        setTouched(true);
        if (nameMissing) return;
        setBusy('save');
        setError('');
        try {
          const view = unwrap(
            await api.saveGen({
              id: draft.id,
              kind: 'preset',
              name: draft.name.trim(),
              description: draft.description || (draft.instructions ? draft.instructions.slice(0, 46) : ''),
              instructions: draft.instructions,
              disableKnowledge: true,
            }),
          );
          onSaved(view, { keepEditing: false, kind: 'preset' });
        } catch (reason) {
          setError(String(reason?.message ?? reason));
        } finally {
          setBusy('');
        }
      };

      return h(
        'div',
        { className: 'dshg-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': '编辑预设' },
        h(
          'div',
          { className: 'dshg-sheet-head' },
          h(
            'button',
            { type: 'button', className: 'dshg-back', onClick: onCancel, title: '返回列表', 'aria-label': '返回列表' },
            h(Icon, { name: 'IconChevronLeftOutlineRegular', size: 18 }),
          ),
          h('span', { className: 'dshg-avatar', style: { width: 40, height: 40 } }, h(QIcon, { name: 'fileText', size: 20 })),
          h('div', { className: 'dshg-head-title', style: { fontSize: 16 } }, draft.name.trim() === '' ? '新建预设' : draft.name.trim()),
          h('span', { className: 'dshg-grow' }),
          h(
            'button',
            {
              type: 'button',
              className: 'dshg-primary',
              disabled: busy !== '' || nameMissing,
              onClick: save,
            },
            busy === 'save' ? '保存中…' : '保存',
          ),
        ),
        h(
          'div',
          { className: 'dshg-sheet-body' },
          h(
            'div',
            { className: 'dshg-sheet-inner' },
            error === '' ? null : h('div', { className: 'dshg-banner dshg-banner-error' }, error),
            h(
              'div',
              { className: 'dshg-editor' },
              h(
                'div',
                { className: 'dshg-form' },
                h(
                  'div',
                  null,
                  h('div', { className: 'dshg-label' }, '名称'),
                  h(
                    'div',
                    { className: `dshg-field${touched && nameMissing ? ' dshg-field-invalid' : ''}` },
                    h('input', {
                      className: 'dshg-input',
                      value: draft.name,
                      placeholder: '为你的预设命名',
                      onChange: (event) => onChange({ name: event.target.value }),
                      onBlur: () => setTouched(true),
                    }),
                  ),
                  touched && nameMissing
                    ? h('div', { className: 'dshg-error' }, '你需要为预设命名，然后才能保存。')
                    : null,
                ),
                h(
                  'div',
                  null,
                  h('div', { className: 'dshg-label' }, '内容'),
                  h(
                    'div',
                    { className: 'dshg-field' },
                    h('textarea', {
                      className: 'dshg-input dshg-textarea',
                      style: { minHeight: 280 },
                      rows: 12,
                      value: draft.instructions,
                      placeholder: '输入提示词预设内容，例如系统设定、特定格式要求或专业回答准则...',
                      onChange: (event) => onChange({ instructions: event.target.value }),
                    }),
                  ),
                ),
              ),
              h(
                'aside',
                { className: 'dshg-preview', 'aria-live': 'polite' },
                h('div', { className: 'dshg-preview-title' }, '预设实时预览'),
                draft.name.trim() !== ''
                  ? h(
                      React.Fragment,
                      null,
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 12 } },
                        h('span', { className: 'dshg-avatar' }, h(QIcon, { name: 'fileText', size: 22 })),
                        h('div', { className: 'dshg-preview-name' }, draft.name.trim()),
                      ),
                      h(
                        'div',
                        { className: 'dshg-preview-block' },
                        h('div', { className: 'dshg-preview-block-title' }, '预设内容'),
                        draft.instructions.trim() === ''
                          ? h('div', { className: 'dshg-note' }, '（未填写预设内容）')
                          : h(MarkdownBlock, { text: draft.instructions }),
                      ),
                    )
                  : h(
                      'div',
                      { className: 'dshg-preview-empty' },
                      h('span', { className: 'dshg-avatar' }, h(QIcon, { name: 'fileText', size: 22 })),
                      h('div', null, '为预设命名后才能预览'),
                    ),
              ),
            ),
          ),
        ),
      );
    };

    /* ── list ───────────────────────────────────────────────────────────── */
    const List = ({
      view,
      activeTab = 'skill',
      onTabChange,
      onCreate,
      onEdit,
      onDelete,
      onClone,
      onExport,
      onExportAll,
      onImport,
      onChat,
      onTogglePicker,
      onOpenWorkspace,
    }) => {
      const allGens = Array.isArray(view?.gens) ? view.gens : [];
      const tab = activeTab ?? 'skill';
      const setTab = onTabChange ?? (() => {});
      const [createMenuOpen, setCreateMenuOpen] = useState(false);
      const importInputRef = useRef(null);
      const createMenuRef = useRef(null);

      const skillList = allGens.filter((g) => (g.kind ?? 'skill') === 'skill');
      const presetList = allGens.filter((g) => g.kind === 'preset');
      const currentList = tab === 'skill' ? skillList : presetList;

      useEffect(() => {
        if (!createMenuOpen) return;
        const closeMenu = (e) => {
          if (createMenuRef.current && !createMenuRef.current.contains(e.target)) {
            setCreateMenuOpen(false);
          }
        };
        document.addEventListener('pointerdown', closeMenu);
        return () => document.removeEventListener('pointerdown', closeMenu);
      }, [createMenuOpen]);

      return h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'dshg-head' },
          h(
            'div',
            { className: 'dshg-seg' },
            h(
              'button',
              {
                type: 'button',
                className: 'dshg-seg-btn',
                'data-active': tab === 'skill' ? 'true' : 'false',
                onClick: () => setTab('skill'),
              },
              `技能 (${skillList.length})`,
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dshg-seg-btn',
                'data-active': tab === 'preset' ? 'true' : 'false',
                onClick: () => setTab('preset'),
              },
              `预设 (${presetList.length})`,
            ),
          ),
          h('span', { className: 'dshg-grow' }),
          h(
            'button',
            {
              type: 'button',
              className: 'dshg-ghost',
              title: '从文件导入技能或预设',
              onClick: () => importInputRef.current?.click(),
            },
            h(QIcon, { name: 'upload', size: 15 }),
            '导入',
          ),
          allGens.length > 0
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'dshg-ghost',
                  title: '将全部技能与预设打包导出备份',
                  onClick: onExportAll,
                },
                h(QIcon, { name: 'download', size: 15 }),
                '备份全部',
              )
            : null,
          h('input', {
            ref: importInputRef,
            type: 'file',
            accept: '.json,.dshgen',
            style: { display: 'none' },
            onChange: (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) onImport(file);
            },
          }),
          h(
            'div',
            { className: 'dshg-dropdown', ref: createMenuRef },
            h(
              'button',
              {
                type: 'button',
                className: 'dshg-primary',
                onClick: () => setCreateMenuOpen((o) => !o),
              },
              h(Icon, { name: 'IconPlusOutlineRegular', size: 16 }),
              '新建',
              h(QIcon, { name: 'chevronDown', size: 13 }),
            ),
            createMenuOpen
              ? h(
                  'div',
                  { className: 'dshg-dropdown-menu' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dshg-dropdown-item',
                      onClick: () => {
                        setCreateMenuOpen(false);
                        onCreate('skill');
                      },
                    },
                    h(QIcon, { name: 'sparkle', size: 15 }),
                    '技能',
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dshg-dropdown-item',
                      onClick: () => {
                        setCreateMenuOpen(false);
                        onCreate('preset');
                      },
                    },
                    h(QIcon, { name: 'fileText', size: 15 }),
                    '预设',
                  ),
                )
              : null,
          ),
        ),
        view?.notice !== undefined && view.notice !== ''
          ? h('div', { className: 'dshg-banner', style: { borderColor: 'var(--dsw-alias-border-l3)' } }, view.notice)
          : null,
        view?.workspacePath === undefined
          ? null
          : h(
              'div',
              { className: 'dshg-banner' },
              `数据保存在 ${view.workspacePath}，它同时是「dsh-gen」工作区。`,
              ' ',
              h(
                'button',
                { type: 'button', className: 'dshg-ghost', style: { padding: '0 4px' }, onClick: onOpenWorkspace },
                '查看工作区路径',
              ),
            ),
        currentList.length === 0
          ? h(
              'div',
              { className: 'dshg-empty' },
              h(QIcon, { name: tab === 'skill' ? 'sparkle' : 'fileText', size: 24 }),
              h('div', null, tab === 'skill' ? '还没有技能' : '还没有预设'),
              h(
                'div',
                { className: 'dshg-note' },
                tab === 'skill'
                  ? '新建一个技能，把指令和本地文档交给 AI 使用。'
                  : '新建一个预设，将常用提示词或指令保存为快速调用的卡牌。',
              ),
            )
          : h(
              'ul',
              { className: 'dshg-cards' },
              currentList.map((rawGen) => {
                // The record's own kind decides what the row is. Deriving it from
                // the active tab made a preset edit as a skill whenever the two
                // disagreed — the tab is a filter, never the source of truth.
                const gen = { ...rawGen, kind: rawGen.kind === 'preset' ? 'preset' : 'skill' };
                return h(
                  'li',
                  { key: gen.id },
                  h(
                    'div',
                    {
                      className: 'dshg-card',
                      role: 'button',
                      tabIndex: 0,
                      'data-hidden': gen.pickerHidden === true ? 'true' : 'false',
                      onClick: () => onEdit(gen),
                      onKeyDown: (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onEdit(gen);
                        }
                      },
                    },
                    h(
                      'span',
                      { className: 'dshg-card-avatar', style: avatarStyle(gen.name) },
                      avatarText(gen.name),
                    ),
                    h(
                      'div',
                      { className: 'dshg-card-text' },
                      h('div', { className: 'dshg-card-name' }, gen.name),
                      h(
                        'div',
                        { className: 'dshg-card-desc' },
                        gen.kind === 'preset'
                          ? gen.instructions?.trim() || '（没有内容）'
                          : gen.description?.trim() || '（没有说明）',
                      ),
                      h(
                        'div',
                        { className: 'dshg-card-meta' },
                        gen.kind === 'preset'
                          ? '提示词预设'
                          : gen.knowledgeCount > 0
                          ? `${gen.knowledgeCount} 个知识文件`
                          : '未挂载知识文件',
                        gen.pickerHidden === true ? ' · 会话内已隐藏' : null,
                        gen.enabled === false ? ' · 已停用' : null,
                        gen.updatedAt === undefined ? null : ` · ${timeText(gen.updatedAt)}`,
                      ),
                    ),
                    h(
                      'div',
                      { className: 'dshg-card-actions' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dshg-icon-btn',
                          title: gen.kind === 'preset' ? '用这个预设新建对话' : '用这个技能新建对话',
                          'aria-label': `用 ${gen.name} 新建对话`,
                          onClick: (event) => {
                            event.stopPropagation();
                            onChat(gen);
                          },
                        },
                        h(QIcon, { name: 'chat', size: 16, strokeWidth: 1.8 }),
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dshg-icon-btn',
                          title: gen.kind === 'preset' ? '克隆预设' : '克隆技能',
                          'aria-label': `克隆 ${gen.name}`,
                          onClick: (event) => {
                            event.stopPropagation();
                            onClone(gen);
                          },
                        },
                        h(QIcon, { name: 'copy', size: 16, strokeWidth: 1.8 }),
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dshg-icon-btn',
                          title: '编辑',
                          'aria-label': `编辑 ${gen.name}`,
                          onClick: (event) => {
                            event.stopPropagation();
                            onEdit(gen);
                          },
                        },
                        h(QIcon, { name: 'pencil', size: 16, strokeWidth: 1.8 }),
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dshg-icon-btn',
                          title: gen.kind === 'preset' ? '导出预设' : '导出技能',
                          'aria-label': `导出 ${gen.name}`,
                          onClick: (event) => {
                            event.stopPropagation();
                            onExport(gen);
                          },
                        },
                        h(QIcon, { name: 'download', size: 16, strokeWidth: 1.8 }),
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dshg-icon-btn dshg-danger',
                          title: '删除',
                          'aria-label': `删除 ${gen.name}`,
                          onClick: (event) => {
                            event.stopPropagation();
                            onDelete(gen);
                          },
                        },
                        h(QIcon, { name: 'trash', size: 16, strokeWidth: 1.8 }),
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: `dshg-icon-btn${gen.pickerHidden === true ? ' dshg-icon-btn-off' : ''}`,
                          title:
                            gen.pickerHidden === true
                              ? '会话内不显示，点击恢复'
                              : '在会话内显示，点击隐藏',
                          'aria-label':
                            gen.pickerHidden === true ? `在会话内显示 ${gen.name}` : `在会话内隐藏 ${gen.name}`,
                          'aria-pressed': gen.pickerHidden !== true,
                          onClick: (event) => {
                            event.stopPropagation();
                            onTogglePicker(gen);
                          },
                        },
                        h(QIcon, { name: gen.pickerHidden === true ? 'eyeOff' : 'eye', size: 16, strokeWidth: 1.8 }),
                      ),
                    ),
                  ),
                );
              }),
            ),
      );
    };

    /* ── section root ───────────────────────────────────────────────────── */
    const DshGenSection = (props) => {
      const [api, setApi] = useState(() => getCapturedApi());
      const [view, setView] = useState(null);
      const [draft, setDraft] = useState(null);
      const [activeTab, setActiveTab] = useState('skill');
      const [error, setError] = useState('');
      const [loading, setLoading] = useState(true);
      const retries = useRef(0);
      /** The settings shell hands a section `close`, so starting a chat can
          leave the panel behind. */
      const onClose = typeof props?.close === 'function' ? props.close : undefined;

      const load = useCallback(async () => {
        const client = getCapturedApi();
        if (client === undefined) {
          retries.current += 1;
          if (retries.current <= 40) setTimeout(() => void load(), 250);
          else {
            setLoading(false);
            setError('插件还没有加载好：请重启 DSH 后再打开这个页面。');
          }
          return;
        }
        setApi(client);
        try {
          const next = unwrap(await client.listGens());
          setView(next);
          setError('');
        } catch (reason) {
          setError(String(reason?.message ?? reason));
        } finally {
          setLoading(false);
        }
      }, []);

      useEffect(() => {
        void load();
      }, [load]);

      const applyView = (next, options) => {
        if (next !== null && typeof next === 'object') setView(next);
        if (options?.kind === 'preset') setActiveTab('preset');
        else if (options?.kind === 'skill') setActiveTab('skill');
        if (options?.keepEditing !== true) {
          setDraft(null);
          return;
        }
        const id = draft?.id;
        if (id === undefined) return;
        const fresh = (next?.gens ?? []).find((gen) => gen.id === id);
        if (fresh !== undefined) setDraft(draftOf(fresh));
      };

      const deleteGen = async (gen) => {
        if (api === undefined) return;
        const isPreset = gen.kind === 'preset';
        const confirmText = isPreset ? `删除预设「${gen.name}」？` : `删除技能「${gen.name}」？挂载的知识文件会一起删除。`;
        if (!window.confirm(confirmText)) return;
        try {
          const next = unwrap(await api.deleteGen({ id: gen.id }));
          applyView(next, { keepEditing: false, kind: isPreset ? 'preset' : 'skill' });
        } catch (reason) {
          setError(String(reason?.message ?? reason));
        }
      };

      const cloneGen = async (gen) => {
        if (api === undefined) return;
        const isPreset = gen.kind === 'preset';
        try {
          const next = unwrap(await api.cloneGen({ id: gen.id }));
          applyView(next, { keepEditing: false, kind: isPreset ? 'preset' : 'skill' });
        } catch (reason) {
          setError(String(reason?.message ?? reason));
        }
      };

      const exportGen = async (gen) => {
        if (api === undefined) return;
        try {
          const pkg = unwrap(await api.exportGen({ id: gen.id }));
          const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${gen.name || (gen.kind === 'preset' ? 'preset' : 'skill')}.dshgen.json`;
          a.click();
          URL.revokeObjectURL(url);
        } catch (reason) {
          setError(String(reason?.message ?? reason));
        }
      };

      const exportAllGens = async () => {
        if (api === undefined) return;
        try {
          const pkg = unwrap(await api.exportAllGens());
          const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const now = new Date().toISOString().slice(0, 10);
          a.href = url;
          a.download = `dsh-backup-${now}.json`;
          a.click();
          URL.revokeObjectURL(url);
          // A backup that quietly dropped files is worse than no backup: say so.
          if (Array.isArray(pkg?.missing) && pkg.missing.length > 0) {
            window.alert(`备份已完成，但有 ${pkg.missing.length} 个文件在磁盘上找不到，未能包含：\n${pkg.missing.slice(0, 10).join('\n')}${pkg.missing.length > 10 ? '\n…' : ''}`);
          }
        } catch (reason) {
          setError(String(reason?.message ?? reason));
        }
      };

      const importPackage = async (file) => {
        if (api === undefined || !file) return;
        try {
          const text = await file.text();
          const packageData = JSON.parse(text);
          const next = unwrap(await api.importPackage({ packageData }));
          applyView(next, { keepEditing: false });
        } catch (reason) {
          setError(`导入失败：${String(reason?.message ?? reason)}`);
        }
      };

      const openWorkspace = async () => {
        if (api === undefined) return;
        try {
          const info = unwrap(await api.openWorkspace());
          window.alert(`工作区：${info.path}`);
        } catch (reason) {
          setError(String(reason?.message ?? reason));
        }
      };

      const startChat = async (gen) => {
        if (api === undefined) return;
        try {
          const info = unwrap(await api.openWorkspace());
          const workspaceId = info?.workspaceId;
          if (typeof workspaceId !== 'string' || workspaceId === '') throw new Error('工作区还没有准备好');
          const workspaceUi = ctxUiWorkspace();
          if (workspaceUi === undefined || typeof workspaceUi.openWorkspace !== 'function') {
            throw new Error('会话导航服务不可用');
          }
          onClose?.();
          // A preset is not a role: opening a chat from a preset card creates a
          // plain Session. Its text is offered in the conversation picker instead,
          // where picking it writes into that Session's composer.
          if (gen.kind === 'preset') {
            await workspaceUi.openWorkspace(workspaceId);
            return;
          }
          await workspaceUi.openWorkspace(workspaceId, (id) => {
            void api.bindSession({ sessionId: id, genId: gen.id }).catch(() => {});
          });
        } catch (reason) {
          setError(String(reason?.message ?? reason));
        }
      };

      const togglePicker = async (gen) => {
        if (api === undefined) return;
        const nextHidden = gen.pickerHidden !== true;
        setView((current) =>
          current === null
            ? current
            : {
                ...current,
                gens: current.gens.map((item) =>
                  item.id === gen.id ? { ...item, pickerHidden: nextHidden } : item,
                ),
              },
        );
        try {
          const next = unwrap(
            await api.saveGen({
              id: gen.id,
              kind: gen.kind === 'preset' ? 'preset' : 'skill',
              name: gen.name,
              description: gen.description,
              instructions: gen.instructions,
              disableKnowledge: gen.disableKnowledge === true,
              pickerHidden: nextHidden,
            }),
          );
          if (next !== null && typeof next === 'object') setView(next);
        } catch (reason) {
          setError(String(reason?.message ?? reason));
          setView((current) =>
            current === null
              ? current
              : {
                  ...current,
                  gens: current.gens.map((item) =>
                    item.id === gen.id ? { ...item, pickerHidden: !nextHidden } : item,
                  ),
                },
          );
        }
      };

      const body = useMemo(() => {
        if (loading) return h('div', { className: 'dshg-note' }, '正在读取…');
        if (error !== '' && view === null) return h('div', { className: 'dshg-banner dshg-banner-error' }, error);
        if (draft !== null) {
          if (draft.kind === 'preset') {
            return h(PresetEditor, {
              api,
              draft,
              onChange: (patch) => setDraft((current) => ({ ...current, ...patch })),
              onSaved: applyView,
              onCancel: () => setDraft(null),
            });
          }
          return h(Editor, {
            api,
            draft,
            onChange: (patch) => setDraft((current) => withVisibleKnowledge({ ...current, ...patch })),
            onSaved: applyView,
            onCancel: () => setDraft(null),
          });
        }
        return h(List, {
          view,
          activeTab,
          onTabChange: setActiveTab,
          onCreate: (kind = 'skill') => {
            setActiveTab(kind);
            setDraft(emptyDraft(kind));
          },
          onEdit: (gen) => {
            const nextDraft = draftOf(gen);
            setActiveTab(nextDraft.kind);
            setDraft(nextDraft);
          },
          onDelete: (gen) => void deleteGen(gen),
          onClone: (gen) => void cloneGen(gen),
          onExport: (gen) => void exportGen(gen),
          onExportAll: () => void exportAllGens(),
          onImport: (file) => void importPackage(file),
          onChat: (gen) => void startChat(gen),
          onTogglePicker: (gen) => void togglePicker(gen),
          onOpenWorkspace: () => void openWorkspace(),
        });
      }, [loading, error, view, draft, activeTab, api, onClose]);

      return h('div', { className: 'dshg-root' }, error !== '' && view !== null ? h('div', { className: 'dshg-banner dshg-banner-error' }, error) : null, body);
    };

    /* ── card fan + pager (the picker's popover body) ──────────────────────
       Five cards per group, laid out after Amicro's CardArc5: at rest they
       overlap as a neat stack, and hovering anywhere on the deck fans them out
       — each card's rotation, horizontal offset and parabola in Y all scale
       with its distance from the middle. The geometry is computed from the
       slot index rather than measured, because the fan must not change the
       popover's footprint: the stage keeps the resting width and the spread
       simply overflows into the menu's padding. */

    /** Cards per group; the fan has exactly this many slots. */
    const CARDS_PER_GROUP = 5;

    /** How long an untouched picker popover stays open before folding away. */
    const IDLE_CLOSE_MS = 60_000;

    /**
     * Trim a description to `max` characters on a word boundary where possible.
     * The card also clamps to three lines in CSS; this keeps the *data* small so
     * a very long description cannot shift the layout before the clamp applies,
     * and the `title` attribute still carries the full text.
     */
    const clipText = (text, max = 46) => {
      const value = typeof text === 'string' ? text.trim() : '';
      if (value === '') return '（没有说明）';
      const chars = [...value];
      if (chars.length <= max) return value;
      const head = chars.slice(0, max).join('');
      // Prefer a break at the last punctuation or space so the cut reads cleanly.
      const cut = Math.max(head.lastIndexOf('，'), head.lastIndexOf('。'), head.lastIndexOf(' '), head.lastIndexOf('、'));
      const trimmed = cut > max * 0.6 ? head.slice(0, cut) : head;
      return `${trimmed}…`;
    };

    /**
     * One slot's transform. `dist` is the signed distance from the middle slot,
     * so the fan is symmetric; a lone card sits flat and centred.
     *
     * Hover moves ONLY the card under the pointer. An earlier version reused the
     * dock's distance falloff here, which meant hovering the leftmost card also
     * lifted the middle one — the fan read as breathing rather than as a cursor.
     * A row of cards is a target, not a magnifying dock: one card answers.
     */
    const fanTransform = (dist, spread, total, hovered) => {
      if (total <= 1) {
        return hovered ? 'translate3d(0,-10px,0) scale(1.06)' : 'translate3d(0,0,0)';
      }
      const maxDist = Math.max(1, Math.floor(total / 2));
      const factor = dist / maxDist;
      const rotate = factor * 7;
      const x = factor * (spread / 2);
      // Parabola: the middle card rides highest, the outer ones dip to the base.
      const y = -8 * (1 - factor * factor);
      const baseScale = dist === 0 ? 1.04 : 1;
      if (hovered) {
        // Straighten and lift the card under the cursor; nothing else moves.
        return `translate3d(${x.toFixed(2)}px, ${(y - 12).toFixed(2)}px, 0) rotate(${(rotate * 0.45).toFixed(2)}deg) scale(${(baseScale + 0.1).toFixed(3)})`;
      }
      return `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${rotate.toFixed(2)}deg) scale(${baseScale})`;
    };

    /**
     * Card deck with two ways to choose a skill:
     *   - a plain click (the fast path);
     *   - long-press and throw the card upward (the playful path).
     *
     * The drag is built on pointer events rather than HTML5 drag-and-drop: the
     * cards are absolutely positioned inside a transformed stage, and the native
     * drag image cannot follow a transform, so the card would tear away from the
     * deck. Here the card's own transform is driven directly.
     */
    const FanDeck = ({ items, active, onPick, hoverIndex, onHover }) => {
      const total = items.length;
      const fanRef = useRef(null);
      /** { index, dx, dy } while a card is in hand; null otherwise. */
      const [drag, setDrag] = useState(null);
      /** Index of the card that has been played and is flying away. */
      const [dealt, setDealt] = useState(null);
      const press = useRef(null);
      const wheelState = useRef({ total, hoverIndex });
      wheelState.current = { total, hoverIndex };

      useEffect(() => {
        const node = fanRef.current;
        if (node === null) return;
        const onWheel = (event) => {
          const { total: count, hoverIndex: current } = wheelState.current;
          if (count <= 1) return;
          const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
          if (Math.abs(delta) < 4) return;
          const step = delta > 0 ? 1 : -1;
          const from = current === null || current === undefined ? (step > 0 ? -1 : count) : current;
          const next = Math.max(0, Math.min(count - 1, from + step));
          if (next === from) return;
          event.preventDefault();
          onHover?.(next);
        };
        node.addEventListener('wheel', onWheel, { passive: false });
        return () => node.removeEventListener('wheel', onWheel);
      }, [onHover]);

      // A press becomes a drag only after the card has been held; a quick press
      // is still a click, so the fast path is unaffected.
      const HOLD_MS = 220;
      /** How far up a card must travel before releasing it counts as a deal. */
      const THROW_PX = 42;

      const clearPress = () => {
        if (press.current !== null && press.current.timer !== undefined) clearTimeout(press.current.timer);
        press.current = null;
      };

      useEffect(() => () => clearPress(), []);

      const beginPress = (event, index) => {
        if (event.button !== undefined && event.button !== 0) return;
        clearPress();
        const startX = event.clientX;
        const startY = event.clientY;
        press.current = {
          index,
          startX,
          startY,
          armed: false,
          pointerId: event.pointerId,
          timer: setTimeout(() => {
            if (press.current === null) return;
            press.current.armed = true;
            setDrag({ index, dx: 0, dy: 0 });
            onHover?.(index);
          }, HOLD_MS),
        };
      };

      const movePress = (event) => {
        const state = press.current;
        if (state === null) return;
        const dx = event.clientX - state.startX;
        const dy = event.clientY - state.startY;
        if (!state.armed) {
          // Moved before the hold completed: this is a click, not a drag.
          if (Math.abs(dx) > 6 || Math.abs(dy) > 6) clearPress();
          return;
        }
        event.preventDefault();
        setDrag({ index: state.index, dx, dy });
      };

      const endPress = (event, gen) => {
        const state = press.current;
        clearPress();
        if (state === null) return;
        if (!state.armed) return; // a plain click: let onClick handle it
        const dy = (event.clientY === undefined ? state.startY : event.clientY) - state.startY;
        const dx = (event.clientX === undefined ? state.startX : event.clientX) - state.startX;
        setDrag(null);
        // Thrown up (or well to either side): play the card.
        if (-dy > THROW_PX || Math.abs(dx) > THROW_PX * 2.2) {
          setDealt(state.index);
          // Let the fly-away animation run before the popover closes.
          setTimeout(() => onPick(gen), 220);
        }
      };

      const spread = Math.min(196, 40 * total + 24);
      const dealing = drag !== null || dealt !== null;

      return h(
        'div',
        {
          className: 'dshg-fan',
          role: 'group',
          ref: fanRef,
          'data-dealing': dealing ? 'true' : 'false',
          onMouseLeave: () => {
            if (drag === null) onHover?.(null);
          },
        },
        items.map((gen, index) => {
          const dist = index - (total - 1) / 2;
          const hovered = hoverIndex === index;
          const inHand = drag !== null && drag.index === index;
          const flying = dealt === index;
          // In hand the card follows the pointer, tilts with the horizontal
          // travel and grows; thrown, it shoots further up and fades.
          let transform = fanTransform(dist, spread, total, hovered);
          if (inHand) {
            const tilt = Math.max(-14, Math.min(14, drag.dx * 0.12));
            transform = 'translate3d(' + (drag.dx + dist * 34).toFixed(1) + 'px, ' + (drag.dy - 26).toFixed(1) + 'px, 0) rotate(' + tilt.toFixed(1) + 'deg) scale(1.08)';
          } else if (flying) {
            transform = 'translate3d(' + (dist * 34).toFixed(1) + 'px, -150px, 0) rotate(' + (dist * 4).toFixed(1) + 'deg) scale(0.86)';
          }
          return h(
            'button',
            {
              key: gen.id,
              type: 'button',
              role: 'menuitemradio',
              'aria-checked': gen.id === active,
              'data-active': gen.id === active ? 'true' : 'false',
              'data-hover': hovered ? 'true' : 'false',
              'data-armed': inHand ? 'true' : 'false',
              'data-dealt': flying ? 'true' : 'false',
              className: 'dshg-fan-card',
              title: gen.name + (gen.description ? ' — ' + gen.description : ''),
              style: {
                zIndex: inHand || flying ? 30 : 10 - Math.abs(Math.round(dist)) + (hovered ? 6 : 0),
                transform,
                // While in hand the transform is pointer-driven; a transition
                // would lag behind the cursor.
                transition: inHand ? 'none' : undefined,
              },
              onPointerDown: (event) => beginPress(event, index),
              onPointerMove: movePress,
              onPointerUp: (event) => endPress(event, gen),
              onPointerCancel: () => {
                clearPress();
                setDrag(null);
              },
              onMouseEnter: () => {
                if (drag === null) onHover?.(index);
              },
              onFocus: () => onHover?.(index),
              onClick: () => {
                // A drag that ended as a throw already played this card.
                if (dealt !== null) return;
                onPick(gen);
              },
              onDragStart: (event) => event.preventDefault(),
            },
            gen.id === active
              ? h('span', { className: 'dshg-fan-badge' }, h(QIcon, { name: 'check', size: 12, strokeWidth: 2.4 }))
              : null,
            h('span', { className: 'dshg-fan-avatar', style: avatarStyle(gen.name) }, avatarText(gen.name)),
            h('span', { className: 'dshg-fan-name' }, gen.name),
            h(
              'span',
              { className: 'dshg-fan-desc' },
              gen.kind === 'preset' ? clipText(gen.instructions, 46) : clipText(gen.description, 46),
            ),
            h(
              'span',
              { className: 'dshg-fan-meta' },
              gen.kind === 'preset'
                ? '提示词预设'
                : gen.knowledgeCount > 0
                ? gen.knowledgeCount + ' 个知识'
                : '无知识',
            ),
          );
        }),
      );
    };

    const Pager = ({ mode, onToggleMode, page, groupCount, total, onPrev, onNext, onGo }) => {
      const dots = Array.from({ length: groupCount }, (_, index) => index);
      return h(
        'div',
        { className: 'dshg-pager' },
        h(
          'button',
          {
            type: 'button',
            className: 'dshg-pager-toggle',
            title: `当前显示：${mode === 'skill' ? '技能' : '预设'}，点击切换`,
            'aria-label': '切换技能与预设',
            onClick: onToggleMode,
          },
          h(QIcon, { name: mode === 'skill' ? 'sparkle' : 'fileText', size: 12 }),
          mode === 'skill' ? '技能' : '预设',
        ),
        h('span', { className: 'dshg-pager-sep' }),
        h(
          'button',
          {
            type: 'button',
            className: 'dshg-pager-btn',
            title: '上一组',
            'aria-label': '上一组',
            disabled: page <= 0,
            onClick: onPrev,
          },
          h(QIcon, { name: 'arrowLeft', size: 14, strokeWidth: 2 }),
        ),
        groupCount <= 6
          ? h(
              'div',
              { className: 'dshg-pager-dots' },
              dots.map((index) =>
                h('button', {
                  key: index,
                  type: 'button',
                  className: 'dshg-pager-dot',
                  'data-on': index === page ? 'true' : 'false',
                  'aria-label': `第 ${index + 1} 组`,
                  'aria-current': index === page ? 'true' : undefined,
                  onClick: () => onGo(index),
                }),
              ),
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            className: 'dshg-pager-btn',
            title: '下一组',
            'aria-label': '下一组',
            disabled: page >= groupCount - 1,
            onClick: onNext,
          },
          h(QIcon, { name: 'arrowRight', size: 14, strokeWidth: 2 }),
        ),
        h('span', { className: 'dshg-pager-sep' }),
        h('span', { className: 'dshg-pager-count' }, `共 ${total}`),
        h('span', { className: 'dshg-pager-count' }, `第 ${page + 1}/${groupCount} 组`),
      );
    };

    /* ── in-conversation picker ────────────────────────────────────────────
       Two kinds of card, two different outcomes:

       - a SKILL binds the current Session to a role (the next turn is assembled
         with that role's instructions);
       - a PRESET writes its prompt into the composer, because a preset is a
         snippet of text to send, not a persona to adopt.

       The mode switch at the top of the popover decides which list the fan
       shows; both live in the same store, discriminated by `kind`. */
    const SkillPicker = (props) => {
      const [open, setOpen] = useState(false);
      const [gens, setGens] = useState([]);
      const [binding, setBinding] = useState(null);
      const [busy, setBusy] = useState(false);
      const [pickerMode, setPickerMode] = useState('skill'); // 'skill' | 'preset'
      /** Which five-card group the fan shows; reset whenever the menu opens. */
      const [page, setPage] = useState(0);
      /** Slot under the pointer inside the current group (null = resting fan). */
      const [hoverIndex, setHoverIndex] = useState(null);
      const rootRef = useRef(null);
      const sessionId = props?.session?.sessionId ?? props?.sessionId;

      const api = getCapturedApi();

      const refresh = useCallback(async () => {
        const client = getCapturedApi();
        if (client === undefined) return;
        try {
          const view = unwrap(await client.listGens());
          const all = Array.isArray(view?.gens) ? view.gens : [];
          setGens(all);
        } catch {
          /* the picker stays empty rather than breaking the composer */
        }
      }, []);

      useEffect(() => {
        void refresh();
        if (typeof sessionId !== 'string' || sessionId === '') {
          setBinding(null);
          return;
        }
        void (async () => {
          try {
            const b = unwrap(await api.sessionBinding({ sessionId }));
            setBinding(b);
          } catch {
            setBinding(null);
          }
        })();
      }, [refresh, sessionId, api]);

      useEffect(() => {
        if (!open) return;
        const onPointerDown = (event) => {
          if (rootRef.current !== null && !rootRef.current.contains(event.target)) setOpen(false);
        };
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
          document.removeEventListener('pointerdown', onPointerDown);
          document.removeEventListener('keydown', onKeyDown);
        };
      }, [open]);

      /**
       * Idle collapse: an open deck that nobody touches folds itself away after a
       * minute, so a popover left open does not keep covering the conversation.
       * The timer restarts on any pointer or key activity inside the popover, and
       * is cleared on close — so a fresh click always starts a full minute.
       */
      useEffect(() => {
        if (!open) return;
        let timer;
        const arm = () => {
          if (timer !== undefined) clearTimeout(timer);
          timer = setTimeout(() => setOpen(false), IDLE_CLOSE_MS);
        };
        arm();
        const node = rootRef.current;
        const events = ['pointerdown', 'pointermove', 'wheel', 'keydown'];
        if (node !== null) for (const name of events) node.addEventListener(name, arm, { passive: true });
        return () => {
          if (timer !== undefined) clearTimeout(timer);
          if (node !== null) for (const name of events) node.removeEventListener(name, arm);
        };
      }, [open]);

      /** Bind the current Session for skills, or insert prompt into composer for presets. */
      const choose = async (gen) => {
        setOpen(false);
        if (gen === undefined || gen === null) return;

        // A preset is text to send, not a role to adopt: it lands in the
        // composer and the Session keeps whatever role it already had.
        if (gen.kind === 'preset') {
          const promptText = gen.instructions || gen.description || '';
          if (promptText.trim() === '') {
            window.alert(`预设「${gen.name}」还没有内容。`);
            return;
          }
          const landed = insertPromptIntoComposer(promptText, props?.conversationInput);
          // No silent failure: the slot has no owner to report to, so the user
          // gets told directly when the draft could not be written.
          if (!landed) window.alert('没能写入输入框，请点击输入框后再试一次。');
          return;
        }

        // A skill binds the Session's role.
        if (busy) return;
        setBusy(true);
        try {
          const current = typeof sessionId === 'string' && sessionId !== '' ? sessionId : '';
          if (current !== '') {
            unwrap(await api.bindSession({ sessionId: current, genId: gen.id }));
            setBinding({ sessionId: current, genId: gen.id, genName: gen.name });
            return;
          }
          const info = unwrap(await api.openWorkspace());
          const workspaceId = info?.workspaceId;
          if (typeof workspaceId !== 'string' || workspaceId === '') throw new Error('工作区还没有准备好');
          const workspaceUi = ctxUiWorkspace();
          if (workspaceUi === undefined || typeof workspaceUi.openWorkspace !== 'function') {
            throw new Error('会话导航服务不可用');
          }
          await workspaceUi.openWorkspace(workspaceId, (id) => {
            void api.bindSession({ sessionId: id, genId: gen.id }).catch(() => {});
          });
        } catch (reason) {
          window.alert(String(reason?.message ?? reason));
        } finally {
          setBusy(false);
        }
      };

      const clear = async () => {
        setOpen(false);
        if (typeof sessionId !== 'string' || sessionId === '' || busy) return;
        setBusy(true);
        try {
          unwrap(await api.unbindSession({ sessionId }));
          setBinding({ sessionId, genId: null, genName: null });
        } catch (reason) {
          window.alert(String(reason?.message ?? reason));
        } finally {
          setBusy(false);
        }
      };

      const active = binding?.genId ?? null;
      const activeGen = gens.find((gen) => gen.id === active && (gen.kind ?? 'skill') === 'skill');
      const label = activeGen === undefined ? (pickerMode === 'skill' ? '技能' : '预设') : activeGen.name;

      const toggleMode = () => {
        setPickerMode((cur) => (cur === 'skill' ? 'preset' : 'skill'));
        setPage(0);
        setHoverIndex(null);
      };

      // Visible list filtered by current picker mode
      const listed = gens.filter((gen) => {
        const kind = gen.kind ?? 'skill';
        const isCurrent = gen.id === active && kind === 'skill';
        return kind === pickerMode && (gen.pickerHidden !== true || isCurrent);
      });

      // Five cards per group; the fan is a fixed five-slot stage, so the pager
      // is what keeps the popover the same size no matter how many skills exist.
      const groupCount = Math.max(1, Math.ceil(listed.length / CARDS_PER_GROUP));
      const safePage = Math.min(page, groupCount - 1);
      const pageItems = listed.slice(safePage * CARDS_PER_GROUP, safePage * CARDS_PER_GROUP + CARDS_PER_GROUP);

      return h(
        'div',
        { className: 'dshg-pick', ref: rootRef },
        h(
          'button',
          {
            type: 'button',
            className: 'dshg-pick-trigger',
            'data-bound': activeGen !== undefined ? 'true' : 'false',
            title: activeGen === undefined ? `点击打开${pickerMode === 'skill' ? '技能' : '预设'}卡牌手牌` : `当前技能：${activeGen.name}`,
            'aria-haspopup': 'menu',
            'aria-expanded': open,
            onClick: () => {
              const next = !open;
              setOpen(next);
              if (next) {
                const index = listed.findIndex((gen) => gen.id === active && pickerMode === 'skill');
                setPage(index < 0 ? 0 : Math.floor(index / CARDS_PER_GROUP));
                setHoverIndex(null);
                void refresh();
              }
            },
          },
          activeGen === undefined
            ? h('span', { className: 'dshg-pick-dot', style: { background: 'var(--dsw-alias-border-l3)' } })
            : h('span', { className: 'dshg-pick-dot', style: avatarStyle(activeGen.name) }),
          h('span', { className: 'dshg-pick-name' }, label),
          h(Icon, { name: 'IconChevronDownOutlineRegular', size: 14 }),
        ),
        open
          ? h(
              'div',
              { className: 'dshg-pick-menu', role: 'menu', 'aria-label': '选择技能或预设' },
              listed.length === 0
                ? h(
                    'div',
                    { className: 'dshg-pick-empty' },
                    h(
                      'div',
                      { style: { marginBottom: 8 } },
                      pickerMode === 'skill'
                        ? '暂无可见的技能，前往设置页管理。'
                        : '暂无可见的预设，前往设置页管理。',
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dshg-pager-toggle',
                        onClick: toggleMode,
                      },
                      h(QIcon, { name: pickerMode === 'skill' ? 'fileText' : 'sparkle', size: 12 }),
                      `切换查看${pickerMode === 'skill' ? '预设' : '技能'}`,
                    ),
                  )
                : h(FanDeck, {
                    items: pageItems,
                    active: pickerMode === 'preset' ? null : active,
                    hoverIndex,
                    onPick: (gen) => void choose(gen),
                    onHover: setHoverIndex,
                  }),
              listed.length === 0 ? null : h(Pager, {
                mode: pickerMode,
                onToggleMode: toggleMode,
                page: safePage,
                groupCount,
                total: listed.length,
                onPrev: () => {
                  setHoverIndex(null);
                  setPage(Math.max(0, safePage - 1));
                },
                onNext: () => {
                  setHoverIndex(null);
                  setPage(Math.min(groupCount - 1, safePage + 1));
                },
                onGo: (index) => {
                  setHoverIndex(null);
                  setPage(index);
                },
              }),
              activeGen === undefined || pickerMode === 'preset'
                ? null
                : h(
                    'button',
                    { type: 'button', className: 'dshg-pick-clear', onClick: () => void clear() },
                    h(QIcon, { name: 'close', size: 12, strokeWidth: 2 }),
                    h('span', null, '取消技能角色'),
                  ),
            )
          : null,
      );
    };

    /* ── mounting ───────────────────────────────────────────────────────── */
    let capturedApi;
    const getCapturedApi = () => capturedApi;
    let capturedUiWorkspace;
    const ctxUiWorkspace = () => capturedUiWorkspace;
    /** The conversation service, used to write a preset into the draft store. */
    let capturedConversation;
    const getCapturedConversation = () => capturedConversation;

    /**
     * Slot wrapper that resolves the Session's composer input once and hands it to
     * the picker, so a preset can write through the official draft store instead
     * of guessing at DOM nodes. `conversation.input` needs a retained Session
     * binding, which the slot props carry; when it is unavailable the picker
     * falls back to the DOM path on its own.
     */
    const PickerHost = (props) => {
      const conversationInput = (() => {
        try {
          const conversation = getCapturedConversation();
          const session = props?.session;
          if (conversation === undefined || conversation === null) return undefined;
          if (session !== undefined && typeof conversation.inputFor === 'function') {
            return conversation.inputFor(session);
          }
          return conversation.input;
        } catch {
          return undefined;
        }
      })();
      return h(SkillPicker, { ...props, conversationInput });
    };

    /* ── mounting ───────────────────────────────────────────────────────── */
    const inject = ['slots', 'remote', 'connection'];

    function apply(ctx) {
      const style = injectStyles();
      ctx.effect(() => () => style.remove(), `${NS}: styles`);

      const readWorkspaceUi = () => {
        try {
          return ctx.get('uiWorkspace');
        } catch {
          return undefined;
        }
      };
      capturedUiWorkspace = readWorkspaceUi();
      if (capturedUiWorkspace === undefined && typeof ctx.inject === 'function') {
        ctx.inject(['uiWorkspace'], (scoped) => {
          capturedUiWorkspace = scoped.get('uiWorkspace');
          scoped.effect(() => () => {
            capturedUiWorkspace = undefined;
          }, `${NS}: workspace navigation`);
        });
      }

      // Same treatment for the conversation service: it may not exist when this
      // plugin applies, and a preset insert is only possible once it does.
      const readConversation = () => {
        try {
          return ctx.get('conversation');
        } catch {
          return undefined;
        }
      };
      capturedConversation = readConversation();
      if (capturedConversation === undefined && typeof ctx.inject === 'function') {
        ctx.inject(['conversation'], (scoped) => {
          capturedConversation = scoped.get('conversation');
          scoped.effect(() => () => {
            capturedConversation = undefined;
          }, `${NS}: conversation input`);
        });
      }

      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'dsh-gen',
            order: 40,
            label: () => 'Dsh-Gen',
          },
          DshGenSection,
        ),
      );
      // The composer-row picker is the shortcut: pick a skill without opening
      // settings. It rides the Session scope, so it follows the active Session.
      ctx.slots.inject('conversation.input.left', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.left',
            id: 'dsh-gen-picker',
            order: 60,
            label: () => '技能',
          },
          PickerHost,
        ),
      );
      void (async () => {
        try {
          await ctx.remote.$mount(RPC_REMOTE);
          capturedApi = ctx.get('remote.dshGen');
        } catch (reason) {
          ctx.logger?.warn?.(`[${NS}] could not mount remote namespace: ${String(reason)}`);
        }
      })();
    }

    module.exports = { name: NS, inject, apply };
    return module.exports;
  },
});
