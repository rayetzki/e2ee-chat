<script lang="ts">
  import * as InputGroup from "$lib/components/ui/input-group";
  import * as Field from '$lib/components/ui/field';
  import UserIcon from "@lucide/svelte/icons/user";
  import KeyIcon from "@lucide/svelte/icons/key";
  import InfoIcon from "@lucide/svelte/icons/info";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import { Button } from "$lib/components/ui/button";
  import type { PageProps } from './$types';
  import { enhance } from "$app/forms";
  import { goto } from "$app/navigation";

	let { form }: PageProps = $props();
</script>

<form use:enhance={() => {
  return async ({ result }) => {
    if (result.type === 'success') {
      await goto(`/chat/${result.data}`);
    }
  }
}} method="POST" class="grid w-screen h-screen place-content-center">
  <InputGroup.Root class="py-2">
    <InputGroup.Input min={0} maxlength={20} name="name" placeholder="Як тебе звати?" />
    <InputGroup.Addon>
      <UserIcon />
    </InputGroup.Addon>
  </InputGroup.Root>
  {#if form?.errors?.['name']}
    <Field.FieldError class="p-1">
      {form.errors.name}
    </Field.FieldError>
  {/if}
  <InputGroup.Root class="mt-2 py-2">
    <InputGroup.Input min={0} maxlength={6} name="password" placeholder="Пароль" />
    <InputGroup.Addon>
      <KeyIcon />
    </InputGroup.Addon>
    <InputGroup.Addon align="inline-end">    
      <Tooltip.Root>
        <Tooltip.Trigger>
          <InfoIcon />
        </Tooltip.Trigger>
        <Tooltip.Content>
          Пароль можна тільки спитати
        </Tooltip.Content>
      </Tooltip.Root>
    </InputGroup.Addon>
  </InputGroup.Root>
  {#if form?.errors?.["password"]}
    <Field.FieldError class="p-1">
      {form.errors?.["password"]}
    </Field.FieldError>
  {/if}
  <Button type="submit" class="flex flex-row place-self-end max-w-24 mt-2">
    Зайти
  </Button>
</form>
