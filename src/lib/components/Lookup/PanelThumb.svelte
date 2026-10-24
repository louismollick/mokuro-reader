<script lang="ts">
  interface Props {
    image: Blob;
    /** Opens the cropper on the full page. */
    onAdjust: () => void;
  }

  let { image, onAdjust }: Props = $props();

  let url = $derived(URL.createObjectURL(image));
  $effect(() => {
    const current = url;
    return () => URL.revokeObjectURL(current);
  });
</script>

<button type="button" class="panel relative z-10" aria-label="Adjust Panel Crop" onclick={onAdjust}>
  <img src={url} alt="" />
  <span>Panel</span>
</button>

<style>
  .panel {
    display: inline-flex;
    align-items: flex-end;
    gap: 6px;
    min-height: 48px;
  }

  img {
    height: 48px;
    border: 1px solid #4ade80;
    object-fit: contain;
  }

  span {
    font-size: 11px;
    color: #9a9a9a;
  }
</style>
