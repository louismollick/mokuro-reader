<script lang="ts">
  import { onDestroy } from 'svelte';
  import CropperJS from 'cropperjs';
  import 'cropperjs/dist/cropper.css';
  import type { Rect } from '$lib/panel/yolo';

  interface Props {
    /** The full page image. */
    image: Blob;
    /** The current crop, in page pixels. */
    rect: Rect;
    onConfirm: (rect: Rect) => void;
    onCancel: () => void;
  }

  let { image, rect, onConfirm, onCancel }: Props = $props();

  const url = URL.createObjectURL(image);
  let cropper: CropperJS | null = null;

  /** Cropper on the page image once it has loaded, preselecting the current crop. */
  function mountCropper(img: HTMLImageElement) {
    const start = () => {
      cropper = new CropperJS(img, {
        viewMode: 1,
        dragMode: 'none',
        autoCropArea: 1,
        guides: true,
        highlight: false,
        zoomOnWheel: false,
        toggleDragModeOnDblclick: false,
        ready() {
          cropper?.setData({
            x: rect.x1,
            y: rect.y1,
            width: rect.x2 - rect.x1,
            height: rect.y2 - rect.y1
          });
        }
      });
    };
    if (img.complete && img.naturalWidth > 0) start();
    else img.addEventListener('load', start, { once: true });
  }

  function confirm() {
    if (!cropper) return;
    const { x, y, width, height } = cropper.getData(true);
    onConfirm({ x1: x, y1: y, x2: x + width, y2: y + height });
  }

  onDestroy(() => {
    cropper?.destroy();
    URL.revokeObjectURL(url);
  });
</script>

<!-- Outside the sheet: its transform would otherwise contain this fixed overlay. -->
<div class="adjust" role="dialog" aria-label="Adjust Panel Crop" data-popover>
  <div class="stage">
    <img src={url} alt="" use:mountCropper />
  </div>
  <div class="relative z-10 flex justify-end gap-6 px-4 py-3 text-[15px]">
    <button type="button" class="min-h-10 px-2 text-[#9a9a9a]" onclick={onCancel}>Cancel</button>
    <button type="button" class="min-h-10 px-2 font-semibold text-[#4ade80]" onclick={confirm}
      >Save</button
    >
  </div>
</div>

<style>
  .adjust {
    position: fixed;
    inset: 0;
    z-index: 70;
    display: flex;
    flex-direction: column;
    background: #000;
    color: #fff;
  }

  .stage {
    min-height: 0;
    flex: 1;
  }

  .stage img {
    display: block;
    max-width: 100%;
  }

  .stage :global(.cropper-container) {
    height: 100% !important;
  }

  .stage :global(.cropper-bg) {
    background: none;
  }

  /* Larger handles for touch. */
  .stage :global(.cropper-point) {
    width: 20px !important;
    height: 20px !important;
    opacity: 1 !important;
  }
</style>
