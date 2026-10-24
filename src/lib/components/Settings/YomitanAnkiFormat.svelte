<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Button, Helper, Input, Label, Select } from 'flowbite-svelte';
  import type { ProfileOptions } from 'yomitan-core';
  import { settings } from '$lib/settings';
  import { getDeckNames, getModelFieldNames, getModelNames } from '$lib/anki-connect';
  import { editProfile, getYomitan } from '$lib/yomitan/client';

  // The card format lives in the yomitan-core profile (`anki.cardFormats[0]`,
  // `anki.duplicateBehavior`); these mirror it for the form. The AnkiConnect connection and the
  // tag template belong to mokuro's AnkiConnect settings.
  type DuplicateBehavior = 'new' | 'overwrite' | 'prevent';
  const duplicateBehaviorOptions: Array<{ value: DuplicateBehavior; name: string }> = [
    { value: 'new', name: 'Add a new note (allow duplicates)' },
    { value: 'overwrite', name: 'Overwrite the existing note' },
    { value: 'prevent', name: 'Prevent duplicates' }
  ];

  let isConnected = $derived($settings.ankiConnectSettings.connectionData?.connected ?? false);

  let deckName = $state('');
  let modelName = $state('');
  let fieldMappings = $state<Record<string, string>>({});
  let duplicateBehavior = $state<DuplicateBehavior>('new');
  let decks = $state<string[]>([]);
  let models = $state<string[]>([]);
  let modelFields = $state<string[]>([]);
  let fieldMarkers = $state<string[]>([]);
  let isLoading = $state(false);
  let profileReady: Promise<void> = Promise.resolve();

  let deckOptions = $derived(decks.map((deck) => ({ value: deck, name: deck })));
  let modelOptions = $derived(models.map((model) => ({ value: model, name: model })));
  // Kiku is a Lapis fork with the same field names, so both share one recommended mapping.
  let hasRecommendedMapping = $derived(['lapis', 'kiku'].includes(modelName.trim().toLowerCase()));
  let mappingButtonLabel = $derived(
    hasRecommendedMapping ? `Use recommended ${modelName.trim()} mapping` : 'Use default mapping'
  );

  function ensureCardFormat(options: ProfileOptions) {
    if (!options.anki.cardFormats[0]) {
      options.anki.cardFormats[0] = {
        type: 'term',
        name: 'Popup',
        deck: 'Default',
        model: '',
        fields: {},
        icon: 'big-circle'
      } as ProfileOptions['anki']['cardFormats'][number];
    }
    return options.anki.cardFormats[0];
  }

  async function loadProfileState() {
    const client = await getYomitan();
    const { anki } = client.profile.get().options;
    const format = anki.cardFormats[0];
    deckName = format?.deck ?? '';
    modelName = format?.model ?? '';
    fieldMappings = Object.fromEntries(
      Object.entries(format?.fields ?? {}).map(([field, { value }]) => [field, value])
    );
    duplicateBehavior = anki.duplicateBehavior as DuplicateBehavior;
  }

  async function saveDeck() {
    const deck = deckName;
    await editProfile((options) => {
      ensureCardFormat(options).deck = deck;
    });
  }

  async function saveFields(model: string, fields: Record<string, string>) {
    await editProfile((options) => {
      const format = ensureCardFormat(options);
      const previous = format.fields ?? {};
      format.model = model;
      format.name = model || format.name;
      format.fields = Object.fromEntries(
        Object.entries(fields).map(([field, value]) => [
          field,
          { overwriteMode: previous[field]?.overwriteMode ?? 'coalesce', value }
        ])
      ) as typeof format.fields;
    });
  }

  async function saveDuplicateBehavior() {
    const behavior = duplicateBehavior;
    await editProfile((options) => {
      options.anki.duplicateBehavior = behavior;
    });
  }

  async function loadConfig() {
    isLoading = true;
    try {
      await profileReady;
      const [deckList, modelList, markers] = await Promise.all([
        getDeckNames(),
        getModelNames(),
        getYomitan()
          .then((client) => client.anki.markers('term'))
          .catch(() => [] as string[])
      ]);

      decks = deckList;
      models = modelList;
      fieldMarkers = [...markers].sort((a, b) => a.localeCompare(b));

      if (!deckName && deckList.length > 0) {
        deckName = deckList[0];
        await saveDeck();
      }

      if (!modelName && modelList.length > 0) {
        modelName = modelList[0];
      }

      if (modelName) {
        await loadModelFields(modelName);
      }
    } finally {
      isLoading = false;
    }
  }

  let modelFieldsRequest = 0;

  async function loadModelFields(model: string) {
    const request = ++modelFieldsRequest;
    const fields = await getModelFieldNames(model);
    // A newer model selection wins over this (slower) request.
    if (request !== modelFieldsRequest) return;
    if (fields.length === 0) {
      // A failed request returns []: keep the mapping of the same model, but still save a newly
      // selected model (its old fields belong to the previous note type).
      await editProfile((options) => {
        const format = ensureCardFormat(options);
        if (format.model !== model) {
          format.model = model;
          format.name = model || format.name;
          format.fields = {} as typeof format.fields;
        }
      });
      return;
    }
    modelFields = fields;
    // Only the model's own fields, keeping the values already mapped for them.
    fieldMappings = Object.fromEntries(
      modelFields.map((field) => [field, fieldMappings[field] ?? ''])
    );
    await saveFields(model, fieldMappings);
  }

  async function onModelChange() {
    if (!modelName) return;
    await loadModelFields(modelName);
  }

  function updateFieldMapping(field: string, value: string) {
    fieldMappings = { ...fieldMappings, [field]: value };
    void saveFields(modelName, fieldMappings);
  }

  function applyRecommendedMappings() {
    const next = { ...fieldMappings };
    const findField = (name: string) =>
      modelFields.find((field) => field.toLowerCase() === name.toLowerCase()) ||
      modelFields.find((field) => field.toLowerCase().includes(name.toLowerCase()));

    if (hasRecommendedMapping) {
      const lapisMappings: Array<[string, string]> = [
        ['Expression', '{expression}'],
        ['ExpressionFurigana', '{furigana-plain}'],
        ['ExpressionReading', '{reading}'],
        ['ExpressionAudio', '{audio}'],
        ['Picture', '{screenshot}'],
        ['SelectionText', '{popup-selection-text}'],
        ['Sentence', '{cloze-prefix}<b>{cloze-body}</b>{cloze-suffix}'],
        ['Glossary', '{glossary}'],
        ['PitchPosition', '{pitch-accent-positions}'],
        ['PitchCategories', '{pitch-accent-categories}'],
        ['Frequency', '{frequencies}'],
        ['FreqSort', '{frequency-harmonic-rank}'],
        ['MiscInfo', '{series} {volume}']
      ];

      for (const [fieldName, value] of lapisMappings) {
        const field = findField(fieldName);
        if (field) next[field] = value;
      }
    } else {
      const expressionField = findField('expression') || modelFields[0];
      const readingField = findField('reading');
      const glossaryField = findField('definition') || findField('glossary');
      const sentenceField = findField('sentence');

      if (expressionField) next[expressionField] = '{expression}';
      if (readingField) next[readingField] = '{reading}';
      if (glossaryField) next[glossaryField] = '{glossary}';
      if (sentenceField) next[sentenceField] = '{sentence}';
    }

    fieldMappings = next;
    void saveFields(modelName, fieldMappings);
  }

  onMount(() => {
    profileReady = loadProfileState().catch((error) => {
      console.error('Failed to load the Yomitan card format:', error);
    });
  });

  // Loads the deck and note type lists whenever AnkiConnect (re)connects.
  $effect(() => {
    if (isConnected) {
      untrack(() => void loadConfig());
    } else {
      decks = [];
      models = [];
      modelFields = [];
    }
  });
</script>

<div class="rounded border border-gray-700 p-3">
  <div class="mb-2 flex items-center justify-between">
    <h4 class="text-sm font-semibold text-gray-900 dark:text-white">Anki card format</h4>
    {#if isConnected}
      <Button size="xs" color="alternative" onclick={loadConfig} disabled={isLoading}>
        {isLoading ? 'Loading...' : 'Refresh'}
      </Button>
    {/if}
  </div>

  {#if !isConnected}
    <Helper>Connect AnkiConnect first.</Helper>
  {:else}
    <div class="mb-3">
      <Label class="text-gray-900 dark:text-white">
        Deck:
        <Select items={deckOptions} bind:value={deckName} onchange={() => void saveDeck()} />
      </Label>
    </div>

    <div class="mb-3">
      <Label class="text-gray-900 dark:text-white">
        Note type:
        <Select items={modelOptions} bind:value={modelName} onchange={onModelChange} />
      </Label>
    </div>

    <div class="mb-3">
      <Label class="text-gray-900 dark:text-white">
        When the note already exists:
        <Select
          items={duplicateBehaviorOptions}
          bind:value={duplicateBehavior}
          onchange={() => void saveDuplicateBehavior()}
        />
      </Label>
    </div>

    <div class="mb-3">
      <Button size="xs" color="alternative" onclick={applyRecommendedMappings}>
        {mappingButtonLabel}
      </Button>
    </div>

    {#if modelFields.length === 0}
      <p class="text-xs text-gray-400">No fields loaded yet. Refresh to load them.</p>
    {:else}
      <div class="flex flex-col gap-3">
        {#each modelFields as field}
          <div class="rounded border border-gray-700 p-2">
            <Label class="mb-1 text-gray-900 dark:text-white">{field}</Label>
            <Input
              type="text"
              value={fieldMappings[field] || ''}
              onchange={(event) =>
                updateFieldMapping(field, (event.currentTarget as HTMLInputElement).value)}
              list="yomitan-marker-options"
              placeholder={'{expression}'}
            />
          </div>
        {/each}
        <datalist id="yomitan-marker-options">
          {#each fieldMarkers as marker}
            <option value={`{${marker}}`}></option>
          {/each}
        </datalist>
      </div>
    {/if}
  {/if}
</div>
