import type { GenerationRequest } from '../../shared/types'
import { removeComments } from '../../shared/nai-presets'
import { processWildcards, type FragmentSource } from './processor'

/** Process each queued image once; split metadata and the transmitted prompt share the result. */
export function preprocessRequest(
  request: GenerationRequest,
  source: FragmentSource
): GenerationRequest {
  const sub = (text: string): string => processWildcards(removeComments(text), source)
  const parts = request.promptParts
    ? {
        base: sub(request.promptParts.base),
        additional: sub(request.promptParts.additional),
        detail: sub(request.promptParts.detail)
      }
    : undefined
  return {
    ...request,
    prompt: parts
      ? [parts.base, parts.additional, parts.detail].filter((part) => part.trim()).join(', ')
      : sub(request.prompt),
    negativePrompt: sub(request.negativePrompt),
    promptParts: parts,
    characterPrompts: request.characterPrompts.map((character) => ({
      ...character,
      prompt: sub(character.prompt),
      negativePrompt: sub(character.negativePrompt)
    }))
  }
}
