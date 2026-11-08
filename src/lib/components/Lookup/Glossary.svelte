<script lang="ts" module>
  import { scopeCssToHost } from '@yomitan-core/web';

  /**
   * The sheet's look over Yomitan's popup CSS (hence `!important`): plain muted tags instead of
   * badges, no collapse button, no forms table. Colors are the app theme's (custom properties
   * reach into the shadow root).
   */
  const LABEL_CSS = `
    :host { display: block; font-size: 14px; line-height: 1.5; color: var(--color-white, #fff); }
    .dictionary-label {
      margin-right: 0.5em;
      font-size: 11px;
      font-weight: 600;
      color: var(--color-gray-400, #9ca3af);
    }
    .tag, .tag-label, .tag-label-content {
      background: none !important;
      border: 0 !important;
      border-radius: 0 !important;
      padding: 0 !important;
      color: var(--color-gray-400, #9ca3af) !important;
      font-size: 11px !important;
      text-shadow: none !important;
    }
    .dictionary-label.float { float: left; }
    .dictionary-label.line { display: block; }
    .tag { margin-right: 0.5em !important; }
    .expansion-button { display: none !important; }
    /* JMdict's table of other spellings and readings: the headword's small line has them. */
    .definition-item:has([data-sc-content='formsTable']) { display: none !important; }
  `;
  let shared: { css: string; sheets: CSSStyleSheet[] } | null = null;

  /** The peek never shows more than this many lines of one dictionary. */
  const PEEK_MAX_LINES = 8;

  /**
   * Where the peek cuts the glossary (px from its top): after the first sense's glosses. Jitendex
   * and the JMdict family mark a sense's gloss list `data-sc-content="glossary"`; other
   * dictionaries end at their first definition's gloss list. Capped at `PEEK_MAX_LINES`. Null
   * when nothing is laid out (no layout engine, or not attached yet).
   */
  function peekCut(
    host: HTMLElement,
    root: ShadowRoot
  ): { height: number; capped: boolean } | null {
    const top = host.getBoundingClientRect().top;
    const end =
      root.querySelector('[data-sc-content="glossary"]') ?? root.querySelector('.gloss-list');
    const bottom = end?.getBoundingClientRect().bottom ?? 0;
    const lineHeight = parseFloat(getComputedStyle(host).lineHeight) || 21;
    const max = lineHeight * PEEK_MAX_LINES;
    if (bottom - top <= 0) return host.scrollHeight > 0 ? { height: max, capped: true } : null;
    const height = Math.ceil(bottom - top);
    return height > max ? { height: max, capped: true } : { height, capped: false };
  }

  /** The popup CSS is large and the same for every block, so build its sheets once per CSS text. */
  function sheetsFor(css: string) {
    if (shared?.css !== css) {
      const sheets = [scopeCssToHost(css), LABEL_CSS].map((text) => {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(text);
        return sheet;
      });
      shared = { css, sheets };
    }
    return shared.sheets;
  }
</script>

<script lang="ts">
  import { findGlossImages, setGlossImageSource } from 'yomitan-core';
  import type { GlossaryBlock, Yomitan } from 'yomitan-core';

  interface Props {
    client: Yomitan;
    block: GlossaryBlock;
    /** Yomitan's popup CSS and the `data-*` attributes it keys off (`render.css()` / `attributes()`). */
    style: { css: string; attributes: Record<string, string> };
    /** Peek: cut after the first sense. */
    compact: boolean;
    /** A `yomitan://lookup` link in a definition was tapped. */
    onQuery: (query: string) => void;
  }

  let { client, block, style, compact, onQuery }: Props = $props();

  let host: HTMLDivElement | undefined = $state();
  /** The peek's cut, or null to show everything. */
  let cut = $state<{ height: number; capped: boolean } | null>(null);

  // Dictionary markup lives in a shadow root so its CSS can't touch the sheet and vice versa. The
  // dictionary's name sits in front of the first definition: a run-in label, not a line of its own.
  $effect(() => {
    if (!host) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    for (const [key, value] of Object.entries(style.attributes)) host.dataset[key] = value;
    root.adoptedStyleSheets = sheetsFor(style.css);

    const container = document.createElement('div');
    container.innerHTML = block.html;
    // The list numbers the senses and the run-in label names the dictionary, so drop the
    // dictionary tag and the numeric "Sense #n" tag; part-of-speech and other tags stay.
    for (const tag of container.querySelectorAll<HTMLElement>('.tag')) {
      const { category } = tag.dataset;
      if (
        category === 'dictionary' ||
        (category === 'default' && /^\d+$/.test(tag.textContent ?? ''))
      ) {
        tag.remove();
      }
    }
    const label = document.createElement('span');
    label.className = 'dictionary-label';
    label.textContent = block.dictionaryAlias.replace(/\s*\[[^\]]*\]\s*$/, '');
    // Before the first definition's tags (plain inline); with none, floated in front of a plain
    // first gloss. Structured content with lists (Jitendex's sense groups) draws its markers
    // outside its boxes, where a float would sit on them, so there it takes its own line.
    const first = container.querySelector('.definition-item');
    const tags = first?.querySelector('.definition-tag-list');
    const gloss = first?.querySelector('.gloss-item');
    if (tags?.firstChild) tags.prepend(label);
    else if (gloss) {
      label.classList.add(gloss.querySelector('ul, ol') ? 'line' : 'float');
      gloss.prepend(label);
    }
    root.replaceChildren(container);

    // Measured now (before paint) and again whenever the text reflows, as when a font arrives.
    let observer: ResizeObserver | undefined;
    if (compact) {
      const target = host;
      const measure = () => (cut = peekCut(target, root));
      measure();
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(measure);
        observer.observe(container);
      }
    } else {
      cut = null;
    }

    // Images are left empty by `media: 'placeholder'`; fill them from the dictionary's media.
    const urls: string[] = [];
    let stale = false;
    for (const image of findGlossImages(container)) {
      client.dictionaries
        .getMedia(image.dictionary, image.path)
        .then((media) => {
          if (stale) return;
          let url: string | null = null;
          if (media) {
            url = URL.createObjectURL(
              new Blob([new Uint8Array(media.content)], { type: media.mediaType })
            );
            urls.push(url);
          }
          setGlossImageSource(image, url, { linkToImage: false });
        })
        .catch(() => setGlossImageSource(image, null));
    }
    return () => {
      stale = true;
      observer?.disconnect();
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  });

  function handleClick(event: MouseEvent) {
    const anchor = event.composedPath().find((node) => node instanceof HTMLAnchorElement);
    if (!anchor) return;
    event.preventDefault();
    if (anchor.href.startsWith('yomitan://')) {
      const query = new URL(anchor.href).searchParams.get('query');
      if (query) onQuery(query);
    } else if (/^https?:/i.test(anchor.href)) {
      // Dictionary markup is user-imported: only open web links, never `javascript:` and the like.
      window.open(anchor.href, '_blank', 'noopener');
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  bind:this={host}
  class="glossary"
  class:cut={cut !== null}
  class:capped={cut?.capped}
  style:max-height={cut ? `${cut.height}px` : undefined}
  lang="ja"
  onclick={handleClick}
></div>

<style>
  .glossary.cut {
    overflow: hidden;
  }

  /* Cut mid-sense: fade the last line out so the cut reads as "more below". */
  .glossary.capped {
    -webkit-mask-image: linear-gradient(#000 calc(100% - 1.5em), transparent);
    mask-image: linear-gradient(#000 calc(100% - 1.5em), transparent);
  }
</style>
