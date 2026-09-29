<script lang="ts">
  import { onMount } from 'svelte';
  import { AccordionItem, Button, Toggle } from 'flowbite-svelte';
  import type { DictionaryOptions, Yomitan } from 'yomitan-core';
  import { updateSetting, settings } from '$lib/settings';
  import { showSnackbar } from '$lib/util/snackbar';
  import { progressTrackerStore } from '$lib/util/progress-tracker';
  import { promptConfirmation } from '$lib/util';
  import { editProfile, getYomitan } from '$lib/yomitan/client';
  import { RECOMMENDED_DICTIONARIES } from '$lib/yomitan/recommended-dictionaries';

  /** Installed dictionaries in profile order: this is what lookups search, in this priority. */
  let dictionaries = $state<DictionaryOptions[]>([]);
  let isRefreshing = $state(false);
  let isInstallingRecommended = $state(false);

  async function refreshDictionaries() {
    isRefreshing = true;
    try {
      const client = await getYomitan();
      await client.profile.syncDictionaries();
      dictionaries = client.profile.get().options.dictionaries;
    } catch (error) {
      console.error('Failed to refresh dictionaries:', error);
      showSnackbar('Failed to load Yomitan dictionaries.');
    } finally {
      isRefreshing = false;
    }
  }

  onMount(() => {
    refreshDictionaries();
  });

  function updatePopupSetting(enabled: boolean) {
    updateSetting('yomitanPopupOnTextBoxTap', enabled);
  }

  /** Edits the profile's dictionary list through the serialized profile queue. */
  async function editDictionaries(edit: (list: DictionaryOptions[]) => void) {
    try {
      await editProfile((options) => edit(options.dictionaries));
      dictionaries = (await getYomitan()).profile.get().options.dictionaries;
    } catch (error) {
      console.error('Failed to update Yomitan dictionaries:', error);
      showSnackbar('Failed to update Yomitan dictionaries.');
    }
  }

  function updateEnabled(name: string, enabled: boolean) {
    return editDictionaries((list) => {
      const entry = list.find((item) => item.name === name);
      if (entry) entry.enabled = enabled;
    });
  }

  function moveDictionary(name: string, direction: -1 | 1) {
    return editDictionaries((list) => {
      // Resolved against the latest list: it may have changed since this row rendered.
      const index = list.findIndex((item) => item.name === name);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= list.length) return;
      const [item] = list.splice(index, 1);
      list.splice(targetIndex, 0, item);
    });
  }

  async function importDictionary(
    client: Yomitan,
    source: File | { url: string },
    processId: string,
    label: string,
    position: number,
    total: number
  ) {
    progressTrackerStore.addProcess({
      id: processId,
      description: 'Importing Yomitan dictionary',
      status: `${label} (${position}/${total})`,
      progress: 0
    });

    await client.dictionaries.import({
      source: source as never,
      onProgress: (progress) => {
        const percentage = progress.count > 0 ? (progress.index / progress.count) * 100 : 0;
        progressTrackerStore.updateProcess(processId, {
          status: `${label} (${position}/${total})`,
          progress: Math.max(0, Math.min(100, percentage))
        });
      }
    });

    progressTrackerStore.updateProcess(processId, {
      status: `${label} imported`,
      progress: 100
    });
  }

  async function handleFileSelection(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    if (files.length === 0) return;

    const processId = `yomitan-upload-${Date.now()}`;
    let imported = 0;
    let failed = 0;

    try {
      const client = await getYomitan();
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          await importDictionary(client, file, processId, file.name, i + 1, files.length);
          imported++;
        } catch (error) {
          failed++;
          console.error(`Failed importing dictionary ${file.name}:`, error);
        }
      }
    } catch (error) {
      failed = files.length - imported;
      console.error('Failed to open the Yomitan database:', error);
    } finally {
      progressTrackerStore.removeProcess(processId);
      await refreshDictionaries();

      if (failed === 0) {
        showSnackbar(`Imported ${imported} dictionar${imported === 1 ? 'y' : 'ies'}.`);
      } else {
        showSnackbar(`Imported ${imported}, failed ${failed}.`);
      }
      input.value = '';
    }
  }

  async function handleDeleteDictionary(title: string) {
    promptConfirmation(`Delete dictionary "${title}"?`, async () => {
      try {
        const client = await getYomitan();
        await client.dictionaries.delete(title);
        await refreshDictionaries();
        showSnackbar(`Deleted ${title}.`);
      } catch (error) {
        console.error(`Failed to delete dictionary ${title}:`, error);
        showSnackbar(`Failed to delete ${title}.`);
      }
    });
  }

  /**
   * mokuro's four recommended dictionaries, resolved against Yomitan's recommended list. One that
   * the list doesn't carry is imported from its URL directly.
   */
  async function resolveRecommended(client: Yomitan) {
    const listed = await client.dictionaries.recommended('ja').catch(() => []);
    return RECOMMENDED_DICTIONARIES.map((url) => {
      const match = listed.find((item) => item.downloadUrl === url);
      return {
        url,
        name: match?.name ?? decodeURIComponent(url.split('/').pop() ?? url).replace(/\.zip$/, '')
      };
    });
  }

  async function installRecommendedDictionaries() {
    isInstallingRecommended = true;
    const processId = `yomitan-recommended-${Date.now()}`;
    let imported = 0;
    let failed = 0;

    progressTrackerStore.addProcess({
      id: processId,
      description: 'Installing recommended dictionaries',
      status: 'Preparing',
      progress: 0
    });

    try {
      const client = await getYomitan();
      const recommended = await resolveRecommended(client);
      const installedTitles = new Set((await client.dictionaries.list()).map((item) => item.title));

      for (let i = 0; i < recommended.length; i++) {
        const { url, name } = recommended[i];

        try {
          if (installedTitles.has(name)) {
            continue;
          }

          progressTrackerStore.updateProcess(processId, {
            status: `Downloading ${name} (${i + 1}/${recommended.length})`
          });
          await importDictionary(client, { url }, processId, name, i + 1, recommended.length);
          imported++;
        } catch (error) {
          failed++;
          console.error(`Failed installing recommended dictionary ${url}:`, error);
        }

        progressTrackerStore.updateProcess(processId, {
          progress: ((i + 1) / recommended.length) * 100,
          status: `${i + 1} / ${recommended.length}`
        });
      }
    } catch (error) {
      failed = RECOMMENDED_DICTIONARIES.length - imported;
      console.error('Failed installing recommended dictionaries:', error);
    } finally {
      isInstallingRecommended = false;
      progressTrackerStore.removeProcess(processId);
      await refreshDictionaries();

      if (failed === 0) {
        showSnackbar(`Installed ${imported} recommended dictionaries.`);
      } else {
        showSnackbar(`Installed ${imported}, failed ${failed}.`);
      }
    }
  }
</script>

<AccordionItem open>
  {#snippet header()}Yomitan{/snippet}
  <div class="flex flex-col gap-4">
    <Toggle
      checked={$settings.yomitanPopupOnTextBoxTap}
      onchange={(event) => updatePopupSetting((event.currentTarget as HTMLInputElement).checked)}
    >
      Enable textbox tap/click Yomitan popup
    </Toggle>

    <div class="flex flex-col gap-2">
      <label class="text-sm text-gray-300" for="yomitan-dictionary-upload"
        >Upload dictionaries (.zip)</label
      >
      <input
        id="yomitan-dictionary-upload"
        type="file"
        accept=".zip"
        multiple
        onchange={handleFileSelection}
        class="block w-full cursor-pointer rounded border border-gray-600 bg-gray-800 p-2 text-sm text-gray-100"
      />
      <Button
        onclick={installRecommendedDictionaries}
        disabled={isInstallingRecommended}
        color="alternative"
      >
        {isInstallingRecommended ? 'Installing...' : 'Install recommended dictionaries'}
      </Button>
    </div>

    <div class="rounded border border-gray-700 p-3">
      <div class="mb-2 flex items-center justify-between">
        <h4 class="text-sm font-semibold text-gray-900 dark:text-white">Installed dictionaries</h4>
        <Button size="xs" color="alternative" onclick={refreshDictionaries} disabled={isRefreshing}
          >Refresh</Button
        >
      </div>

      {#if isRefreshing}
        <p class="text-xs text-gray-400">Loading dictionaries...</p>
      {:else if dictionaries.length === 0}
        <p class="text-xs text-gray-400">No dictionaries installed.</p>
      {:else}
        <div class="flex flex-col gap-2">
          {#each dictionaries as dictionary, index (dictionary.name)}
            <div class="rounded border border-gray-700 p-2">
              <div class="mb-2 text-sm font-medium text-gray-900 dark:text-white">
                {dictionary.name}
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <Toggle
                  checked={dictionary.enabled}
                  onchange={(event) =>
                    updateEnabled(
                      dictionary.name,
                      (event.currentTarget as HTMLInputElement).checked
                    )}>Enabled</Toggle
                >
                <Button
                  size="xs"
                  color="alternative"
                  disabled={index === 0}
                  onclick={() => moveDictionary(dictionary.name, -1)}>Up</Button
                >
                <Button
                  size="xs"
                  color="alternative"
                  disabled={index === dictionaries.length - 1}
                  onclick={() => moveDictionary(dictionary.name, 1)}>Down</Button
                >
                <Button
                  size="xs"
                  color="red"
                  outline
                  onclick={() => handleDeleteDictionary(dictionary.name)}>Delete</Button
                >
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</AccordionItem>
