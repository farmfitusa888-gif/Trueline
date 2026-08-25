import { RoomError } from './room.ts';

/**
 * Signing, without a monthly bill.
 *
 * ## Why this is not a third-party service
 *
 * Under the US ESIGN Act and the state UETAs, an electronic signature cannot be
 * denied legal effect *because it is electronic*. No statute requires a signing
 * vendor. What the vendors sell is not validity — it is **evidence**: a record
 * of who signed, when, that they meant to, that they agreed to sign
 * electronically, and that nothing was altered afterwards. That evidence is
 * what decides a dispute, and every part of it can be produced here for
 * nothing.
 *
 * So this records all five, and refuses to produce a signature missing any of
 * them:
 *
 * 1. **Intent** — the exact sentence the signer agreed to is stored with the
 *    signature, not implied by a button's label.
 * 2. **Consent** — an explicit yes to doing this electronically, recorded
 *    separately from the signature itself, because they are two agreements.
 * 3. **Attribution** — the typed name, alongside the drawn mark. A drawn mark
 *    alone attributes to nobody.
 * 4. **Retention** — the whole record travels inside the saved job file, so
 *    there is nothing to lose access to and no account that can lapse.
 * 5. **Tamper-evidence** — a hash of the exact document that was signed. Change
 *    a price after signing and the seal stops matching, loudly.
 *
 * ## What this is not
 *
 * It is not identity verification. It records that somebody typed a name and
 * drew a mark on a given device at a given moment; it does not prove that the
 * person was who they said. Neither do most e-signature products at their
 * ordinary tiers, and the app never claims otherwise on screen or in this
 * document. Notarisation, witnessing, and anything a state requires for a
 * particular contract are outside this and stay outside it.
 */

export class SignatureError extends RoomError {}

export interface Signature {
  readonly id: string;
  /** Who they typed they were. Attribution. */
  readonly who: string;
  readonly role: 'client' | 'contractor';
  /** The exact sentence they agreed to, kept word for word. */
  readonly intent: string;
  /** A separate, explicit yes to signing electronically at all. */
  readonly consented: boolean;
  /** The drawn mark, as a `data:` URL, so it travels inside the file. */
  readonly mark: string;
  /** ISO 8601, with the offset, because "3pm" is not a time. */
  readonly at: string;
  /** What they signed on, as the device described itself. */
  readonly device: string;
  /**
   * SHA-256 of the document as it stood at that moment.
   *
   * This is the whole of the tamper-evidence. Two people signing the same
   * document produce the same value here; one of them signing a document that
   * has since had a price changed does not.
   */
  readonly documentHash: string;
}

/** The sentence a client agrees to. Stored on the signature, not assumed. */
export const CLIENT_INTENT =
  'I have read this proposal, I agree to the work and the price in the option ' +
  'named above, and I intend this to be my signature.';

/** The sentence a contractor agrees to. */
export const CONTRACTOR_INTENT =
  'I offer this work at this price on these terms, and I intend this to be my signature.';

/** What somebody agrees to before any of it is electronic. */
export const CONSENT =
  'I agree to sign electronically instead of on paper, and to receive this ' +
  'agreement and its records electronically.';

/**
 * A stable text for anything, so two runs hash the same.
 *
 * `JSON.stringify` orders keys by insertion, which means the same proposal
 * built two different ways serialises two different ways and hashes to two
 * different values — a tamper alarm that fires on nothing. Keys are sorted, and
 * bigints are written as digits rather than throwing.
 */
export function canonical(value: unknown): string {
  if (typeof value === 'bigint') return `${value}`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

/**
 * SHA-256, as lowercase hex.
 *
 * `crypto.subtle` rather than a hash written here: this is the one number in
 * the product that has to mean the same thing to somebody else's lawyer, and a
 * hand-rolled digest is a liability rather than an achievement. It is present
 * in the browser and in Node, and it is asynchronous in both.
 */
export async function sha256(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new SignatureError(
      'This device has no cryptography available, so a signature could not be ' +
        'sealed against the document. Nothing was signed.'
    );
  }
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The hash of a document, for sealing a signature to it. */
export async function hashOf(document: unknown): Promise<string> {
  return sha256(canonical(document));
}

export interface SigningRequest {
  readonly id: string;
  readonly who: string;
  readonly role: Signature['role'];
  readonly intent: string;
  readonly consented: boolean;
  readonly mark: string;
  readonly at: string;
  readonly device: string;
}

/**
 * Signs a document, or refuses and says which piece of evidence is absent.
 *
 * Every refusal here is a refusal to produce something that would look like a
 * signature and not stand up as one. A mark with no name attributes to nobody;
 * a name with no consent is a paper signature collected electronically; a
 * signature with no document hash cannot be shown to belong to this version of
 * anything.
 */
export async function sign(document: unknown, request: SigningRequest): Promise<Signature> {
  if (!request.who.trim()) {
    throw new SignatureError('A signature needs a name typed with it, or it attributes to nobody.');
  }
  if (!request.consented) {
    throw new SignatureError(
      'Signing electronically has to be agreed to before it happens. Nothing was signed.'
    );
  }
  if (!request.mark.startsWith('data:image/')) {
    throw new SignatureError('The signature itself is missing.');
  }
  if (!request.intent.trim()) {
    throw new SignatureError('What is being agreed to has to be recorded with the agreement.');
  }
  if (Number.isNaN(Date.parse(request.at))) {
    throw new SignatureError(`"${request.at}" is not a time this can record.`);
  }
  return {
    id: request.id,
    who: request.who.trim(),
    role: request.role,
    intent: request.intent.trim(),
    consented: true,
    mark: request.mark,
    at: request.at,
    device: request.device.trim() || 'not recorded',
    documentHash: await hashOf(document),
  };
}

export type Seal =
  | { readonly ok: true; readonly hash: string }
  | { readonly ok: false; readonly hash: string; readonly signed: string; readonly why: string };

/**
 * Whether a document still matches what was signed.
 *
 * The whole point of the exercise. Run before anything is shown as agreed, and
 * before a change order is written against it: a baseline that has drifted is
 * not a baseline, and finding that out at the end of a job is finding it out
 * too late.
 */
export async function verify(document: unknown, signature: Signature): Promise<Seal> {
  const hash = await hashOf(document);
  if (hash === signature.documentHash) return { ok: true, hash };
  return {
    ok: false,
    hash,
    signed: signature.documentHash,
    why:
      `This is not the document ${signature.who} signed on ` +
      `${signature.at.slice(0, 10)}. Something in it has changed since. The signed ` +
      'version is the one that counts, and the change belongs in a change order.',
  };
}

/**
 * The evidence, written out for a human.
 *
 * What a contractor would have to hand somebody who asked how they know this
 * was agreed. Deliberately plain: a table of hex is not evidence anybody can
 * read, and the point of keeping the record is that it can be produced.
 */
export function describeSignature(signature: Signature): string[] {
  return [
    `${signature.who} signed as the ${signature.role}.`,
    `They agreed: “${signature.intent}”`,
    `They agreed to sign electronically: “${CONSENT}”`,
    `Signed ${signature.at} on ${signature.device}.`,
    `The document they signed fingerprints to ${signature.documentHash.slice(0, 16)}… ` +
      '(SHA-256). Any change to it since produces a different fingerprint.',
  ];
}
