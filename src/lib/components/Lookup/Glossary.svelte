<script lang="ts" module>
  import { scopeCssToHost } from '@yomitan-core/web';

  /**
   * The sheet's look over Yomitan's popup CSS (hence `!important`): plain gray tags instead of
   * badges, no dictionary tag (the run-in label names it), no collapse button.
   */
  const LABEL_CSS = `
    :host { display: block; font-size: 14px; line-height: 1.5; color: #fff; }
    .dictionary-label {
      margin-right: 0.5em;
      font-size: 11px;
      font-weight: 600;
      color: #9a9a9a;
    }
    .tag, .tag-label, .tag-label-content {
      background: none !important;
      border: 0 !important;
      border-radius: 0 !important;
      padding: 0 !important;
      color: #9a9a9a !important;
      font-size: 11px !important;
      text-shadow: none !important;
    }
    .dictionary-label.float { float: left; }
    .tag { margin-right: 0.5em !important; }
    .tag[data-category='dictionary'], .expansion-button { display: none !important; }
  `;
  let shared: { css: string; sheets: CSSStyleSheet[] } | null = null;

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
    /** Peek: clamp to three lines. */
    compact: boolean;
    /** A `yomitan://lookup` link in a definition was tapped. */
    onQuery: (query: string) => void;
  }

  let { client, block, style, compact, onQuery }: Props = $props();

  let host: HTMLDivElement | undefined = $state();

  // Dictionary markup lives in a shadow root so its CSS can't touch the sheet and vice versa. The
  // dictionary's name sits in front of the first definition: a run-in label, not a line of its own.
  $effect(() => {
    if (!host) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    for (const [key, value] of Object.entries(style.attributes)) host.dataset[key] = value;
    root.adoptedStyleSheets = sheetsFor(style.css);

    const container = document.createElement('div');
    container.innerHTML = block.html;
    const label = document.createElement('span');
    label.className = 'dictionary-label';
    label.textContent = block.dictionaryAlias.replace(/\s*\[[^\]]*\]\s*$/, '');
    // Before the first definition's tags (plain inline) or, with none, its first gloss (floated).
    const first = container.querySelector('.definition-item');
    const tags = first?.querySelector('.definition-tag-list');
    const gloss = first?.querySelector('.gloss-item');
    if (tags?.firstChild) tags.prepend(label);
    else if (gloss) {
      label.classList.add('float');
      gloss.prepend(label);
    }
    root.replaceChildren(container);

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
    } else if (anchor.href) {
      window.open(anchor.href, '_blank', 'noopener');
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div bind:this={host} class="glossary" class:compact lang="ja" onclick={handleClick}></div>

<style>
  .glossary.compact {
    max-height: 4.5em;
    overflow: hidden;
    -webkit-mask-image: linear-gradient(#000 65%, transparent);
    mask-image: linear-gradient(#000 65%, transparent);
  }
</style>
