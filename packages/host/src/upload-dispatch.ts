import type { ServerPlugin, UploadedFile } from '../../plugin-sdk/src';
import { AppError, assert } from './errors';
import { readBytes } from './http';

export function uploadHandler(plugins: Record<string, ServerPlugin>, id: string, name: string) {
  const uploads = Object.hasOwn(plugins, id) ? plugins[id]?.uploads : undefined;
  const upload = uploads && Object.hasOwn(uploads, name) ? uploads[name] : undefined;
  assert(upload && typeof upload.handle === 'function', 'not_found', 'Upload does not exist.', 404);
  assert(
    Number.isSafeInteger(upload.maxBytes) &&
      upload.maxBytes > 0 &&
      upload.maxBytes <= 32 * 1024 * 1024,
    'invalid_upload_limit',
    'Upload is not configured correctly.',
    500,
  );
  return upload;
}

/** Bound the streamed body before multipart parsing; a missing/forged Content-Length is not trusted. */
export async function readUpload(
  request: Request,
  limit: number,
): Promise<{ file: UploadedFile; metadata: unknown }> {
  const type = request.headers.get('content-type') ?? '';
  assert(
    type.toLowerCase().startsWith('multipart/form-data;'),
    'invalid_upload',
    'Choose a file to upload.',
  );
  const bytes = await readBytes(request, limit + 16 * 1024);
  let form: FormData;
  try {
    form = await new Response(new Uint8Array(bytes), {
      headers: { 'content-type': type },
    }).formData();
  } catch {
    throw new AppError(
      'invalid_upload',
      'The file upload could not be read. Choose the file again.',
    );
  }
  assert(
    [...form.keys()].length === 2 &&
      form.getAll('file').length === 1 &&
      form.getAll('metadata').length === 1,
    'invalid_upload',
    'Upload one file with its metadata.',
  );
  const file = form.get('file');
  const metadata = form.get('metadata');
  assert(
    file instanceof File && file.size > 0 && file.size <= limit,
    'invalid_upload',
    `Choose a non-empty file no larger than ${limit / 1024 / 1024} MiB.`,
  );
  assert(
    // Control characters and path separators must never become stored filenames.
    // eslint-disable-next-line no-control-regex
    file.name.length <= 255 && !/[\u0000-\u001f\u007f/\\]/.test(file.name),
    'invalid_filename',
    'Use a simple filename of at most 255 characters.',
  );
  assert(
    typeof metadata === 'string' && metadata.length <= 8192,
    'invalid_upload',
    'File metadata is missing or too large.',
  );
  let value: unknown;
  try {
    value = JSON.parse(metadata);
  } catch {
    throw new AppError('invalid_upload', 'File metadata could not be read.');
  }
  return {
    file: { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
    metadata: value,
  };
}
