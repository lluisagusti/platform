import type { Blob, BlobLookup, Ref } from '@hcengineering/core'
import core, { concatLink } from '@hcengineering/core'
import { getMetadata } from '@hcengineering/platform'
import { getBlobHref, getClient, getCurrentWorkspaceUrl, getFileUrl } from '.'
import presentation from './plugin'

type SupportedFormat = string
const defaultSupportedFormats = 'avif,webp,heif,jpeg'

export interface ProviderPreviewConfig {
  // Identifier of provider
  // If set to '' could be applied to any provider, for example to exclude some 'image/gif' etc from being processing with providers.
  providerId: string
  // Preview url
  // If '' preview is disabled for config.
  previewUrl: string
  // A supported file formats
  formats: SupportedFormat[]

  // Content type markers, will check by containts, if passed, only allow to be used with matched content types.
  contentTypes?: string[]
}

export interface PreviewConfig {
  default?: ProviderPreviewConfig
  previewers: Record<string, ProviderPreviewConfig[]>
}

const defaultPreview = (): ProviderPreviewConfig => ({
  providerId: '',
  formats: ['avif', 'webp', 'jpg'],
  previewUrl: `/files/${getCurrentWorkspaceUrl()}?file=:blobId.:format&size=:size`
})

/**
 *
 * PREVIEW_CONFIG env variable format.
 * A `;` separated list of triples, providerName|previewUrl|supportedFormats.

- providerName - a provider name should be same as in Storage configuration.
  It coult be empty and it will match by content types.
- previewUrl - an Url with :workspace, :blobId, :downloadFile, :size, :format placeholders, they will be replaced in UI with an appropriate blob values.
- supportedFormats - a `,` separated list of file extensions.
- contentTypes - a ',' separated list of content type patterns.

 */
export function parsePreviewConfig (config?: string): PreviewConfig {
  if (config === undefined) {
    // TODO: Remove after all migrated
    return {
      default: defaultPreview(),
      previewers: {
        '': [
          {
            providerId: '',
            contentTypes: ['image/gif', 'image/apng'], // Disable gif and apng format preview.
            formats: [],
            previewUrl: ''
          }
        ]
      }
    }
  }
  const result: PreviewConfig = { previewers: {} }
  const configs = config.split(';')
  for (const c of configs) {
    let [provider, url, formats, contentTypes] = c.split('|')
    if (formats === undefined) {
      formats = defaultSupportedFormats
    }
    const p: ProviderPreviewConfig = {
      providerId: provider,
      previewUrl: url,
      formats: formats.split(',').map((it) => it.trim()),
      contentTypes: contentTypes !== undefined ? contentTypes.split(',').map((it) => it.trim()) : undefined
    }

    if (provider === '*') {
      result.default = p
    } else {
      result.previewers[provider] = [...(result.previewers[provider] ?? []), p]
    }
  }
  return result
}

export function getPreviewConfig (): PreviewConfig {
  return getMetadata(presentation.metadata.PreviewConfig) as PreviewConfig
}

export async function getBlobRef (
  blob: Blob | undefined,
  file: Ref<Blob>,
  name?: string,
  width?: number
): Promise<{
    src: string
    srcset: string
  }> {
  let _blob = blob as BlobLookup
  if (_blob === undefined) {
    _blob = (await getClient().findOne(core.class.Blob, { _id: file })) as BlobLookup
  }
  return {
    src: _blob?.downloadUrl ?? getFileUrl(file, name),
    srcset: _blob !== undefined ? getSrcSet(_blob, width) : ''
  }
}

export async function getBlobSrcSet (_blob: Blob | undefined, file: Ref<Blob>, width?: number): Promise<string> {
  if (_blob === undefined) {
    _blob = await getClient().findOne(core.class.Blob, { _id: file })
  }
  return _blob !== undefined ? getSrcSet(_blob, width) : ''
}

/**
 * Select content provider based on content type.
 */
export function selectProvider (
  blob: Blob,
  providers: Array<ProviderPreviewConfig | undefined>
): ProviderPreviewConfig | undefined {
  const isMatched = (it: ProviderPreviewConfig): boolean =>
    it.contentTypes === undefined || it.contentTypes.some((e) => blob.contentType === e || blob.contentType.includes(e))

  return providers.find((it) => it !== undefined && isMatched(it))
}

export function getSrcSet (_blob: Blob, width?: number): string {
  const blob = _blob as BlobLookup
  const c = getPreviewConfig()

  // Select providers from
  const cfg = selectProvider(blob, [...c.previewers[_blob.provider], ...c.previewers[''], c.default])
  if (cfg === undefined || cfg.previewUrl === '') {
    return '' // No previewer is available for blob
  }

  return blobToSrcSet(cfg, blob, width)
}

function blobToSrcSet (
  cfg: ProviderPreviewConfig,
  blob: { _id: Ref<Blob>, downloadUrl?: string },
  width: number | undefined
): string {
  let url = cfg.previewUrl.replaceAll(':workspace', encodeURIComponent(getCurrentWorkspaceUrl()))
  const downloadUrl = blob.downloadUrl ?? getFileUrl(blob._id)

  const frontUrl = getMetadata(presentation.metadata.FrontUrl) ?? window.location.origin
  if (!url.includes('://')) {
    url = concatLink(frontUrl ?? '', url)
  }
  url = url.replaceAll(':downloadFile', encodeURIComponent(downloadUrl))
  url = url.replaceAll(':blobId', encodeURIComponent(blob._id))

  let result = ''
  for (const f of cfg.formats ?? []) {
    if (result.length > 0) {
      result += ', '
    }

    const fu = url.replaceAll(':format', f)

    if (width !== undefined) {
      result +=
        fu.replaceAll(':size', `${width}`) +
        ', ' +
        fu.replaceAll(':size', `${width * 2}`) +
        ', ' +
        fu.replaceAll(':size', `${width * 3}`)
    } else {
      result += fu.replaceAll(':size', `${-1}`)
    }
  }
  return result
}

export async function getBlobSrcFor (blob: Blob | Ref<Blob> | undefined, name?: string): Promise<string> {
  return blob === undefined
    ? ''
    : typeof blob === 'string'
      ? await getBlobHref(undefined, blob, name)
      : await getBlobHref(blob, blob._id)
}

/***
 * @deprecated, please use Blob direct operations.
 */
export function getFileSrcSet (_blob: Ref<Blob>, width?: number): string {
  const cfg = getPreviewConfig()
  return blobToSrcSet(
    cfg.default ?? defaultPreview(),
    {
      _id: _blob
    },
    width
  )
}
