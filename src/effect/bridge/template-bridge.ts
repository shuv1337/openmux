/**
 * Template bridge functions
 * Wraps Effect TemplateStorage service for async/await usage
 */

import { Effect } from "effect"
import { runEffect } from "../runtime"
import { TemplateStorage } from "../services"
import type { TemplateSession } from "../models"

// =============================================================================
// Storage Functions
// =============================================================================

export async function listTemplates(): Promise<TemplateSession[]> {
  return runEffect(
    Effect.gen(function* () {
      const storage = yield* TemplateStorage
      return yield* storage.listTemplates()
    })
  )
}

export async function saveTemplate(template: TemplateSession): Promise<void> {
  await runEffect(
    Effect.gen(function* () {
      const storage = yield* TemplateStorage
      yield* storage.saveTemplate(template)
    })
  )
}

export async function deleteTemplate(id: string): Promise<void> {
  await runEffect(
    Effect.gen(function* () {
      const storage = yield* TemplateStorage
      yield* storage.deleteTemplate(id)
    })
  )
}

export async function loadTemplate(id: string): Promise<TemplateSession | null> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const storage = yield* TemplateStorage
        return yield* storage.loadTemplate(id)
      })
    )
  } catch {
    return null
  }
}

export { buildLayoutFromTemplate } from "./template-layout"
