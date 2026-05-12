import { kvGetSecret, kvSetSecret } from './db'
import { defaultModelFor } from '@shared/models'
import type { ModelUseCase } from '@shared/models'
import type { Engine } from '@shared/types'

function key(useCase: ModelUseCase, engine: Engine): string {
  return `model.${useCase}.${engine}`
}

export function getModel(useCase: ModelUseCase, engine: Engine): string {
  const v = kvGetSecret(key(useCase, engine))
  if (v) return v
  return defaultModelFor(engine)
}

export function setModel(useCase: ModelUseCase, engine: Engine, modelId: string) {
  kvSetSecret(key(useCase, engine), modelId)
}
