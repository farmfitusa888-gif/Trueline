import { type Seal, hashOf, sha256 } from './signature.ts';
import { RoomError } from './room.ts';

/**
 * A document that went out unsigned and came back signed.
 *
 * ## The second way to get a proposal agreed
 *
 * > "SO NOW WE'LL HAVE 2 WAYS TO GET THE PROPOSAL SIGNED"
 *
 * One is `signature.ts`: the client signs on the phone, standing there, and the
 * app records intent, consent, attribution, time, device and a fingerprint of
 * the exact document. The other is the way most jobs are actually won — the
 * contractor sends the proposal, the client prints it, signs it at the kitchen
 * table on Sunday night, photographs it and texts it back.
 *
 * Until now the app could do the first half of that and none of the second. It
 * could send. It could not **file the signed copy back**, so the signed sheet
 * lived in a text thread, attached to nothing, and the job it belonged to had
 * no record that it had ever been agreed.
 *
 * ## Why this is not a `Signature` and must never be made into one
 *
 * A photograph of a signature is weaker evidence than a signature taken on the
 * phone, and the difference is not a matter of degree. `sign()` records five
 * things at the moment of signing: the exact sentence agreed to, a separate
 * consent to signing electronically, a typed name beside the mark, the time and
 * the device, and the fingerprint of the document as it stood right then. A
 * photograph records **an image of a mark**. Everything else about it — who
 * made the mark, when, that they read what they were signing, that they meant
 * it to be their signature — is somebody's account of what happened, and the
 * app's honest position is that it is holding that account rather than proof.
 *
 * So `ReturnedDocument` is deliberately a different shape from `Signature` and
 * from `AgreedChange` in `change.ts`. It cannot be passed to `freeze()`, it
 * cannot be passed to `agreeToChange()`, and no field of it is named `who` or
 * `at` — they are `saysSignedBy` and `saysSignedOn`, because that is what they
 * are. A record that quietly reads like a stronger one is worse than no record,
 * since the contractor would rely on it in the one conversation where it
 * matters.
 *
 * ## What it *can* do that a photograph on its own cannot
 *
 * Two things, and they are the reason this is worth building rather than
 * telling somebody to save the picture in their phone.
 *
 * **It binds the returned sheet to the document that was sent.** The
 * fingerprint of the proposal is known at the moment it goes out. Filing the
 * signed copy re-computes it and refuses, loudly, if it no longer matches —
 * because a proposal edited after it was emailed and before the signed copy
 * came back is the exact shape of an accidental fraud, and the contractor who
 * did it would have no idea.
 *
 * **It fingerprints the returned file itself.** So the photograph on the record
 * can be shown to be the photograph that was filed, and not one swapped for it
 * later.
 *
 * Neither of those makes it as good as signing on the phone. Nothing does, and
 * the app says so on the screen and on the document rather than letting a
 * contractor find out from somebody else's lawyer.
 */

export class CountersignError extends RoomError {}

/** How the signed copy got back to the contractor. */
export type CameBackBy =
  /** A photograph of the signed page, usually texted. */
  | 'photograph'
  /** A PDF, usually emailed. */
  | 'pdf'
  /** Handed over on paper, then photographed or scanned into the app. */
  | 'paper';

/** What each of those is called on a screen and on a record. */
export const CAME_BACK_SAYS: Record<CameBackBy, string> = {
  photograph: 'a photograph of the signed page',
  pdf: 'a signed PDF',
  paper: 'on paper, by hand',
};

/** Which document a returned copy signs. Named, so nothing is guessed. */
export type SignedDocumentKind = 'proposal' | 'change order';

/**
 * A signed copy, filed against the job and against the document it signs.
 *
 * Every field that is somebody's word is named as somebody's word. That is not
 * fussiness — it is the whole difference between this record and the one
 * `sign()` produces, and a field called `signedAt` instead of `saysSignedOn`
 * would erase it in the reader's head six months from now.
 */
export interface ReturnedDocument {
  readonly id: string;
  /** The job this belongs to, by the name it goes by on every other screen. */
  readonly jobName: string;
  /** The specific document it signs — a proposal id or a change order id. */
  readonly documentId: string;
  readonly documentKind: SignedDocumentKind;
  /**
   * The fingerprint of that document at the moment it was sent out.
   *
   * SHA-256 of the document, the same value `signature.ts` seals a signature
   * with. This is what lets the contractor show that the sheet that came back
   * signed is the sheet that went out.
   */
  readonly sentHash: string;
  /** When it went out. The app's own clock. */
  readonly sentAt: string;
  /** Who says they signed it. Their name as it was given, not as it was proved. */
  readonly saysSignedBy: string;
  /** The date they say they signed, `YYYY-MM-DD`. Their word, not the app's. */
  readonly saysSignedOn: string;
  /** When the signed copy reached the contractor. The app's own clock. */
  readonly cameBackAt: string;
  readonly cameBackBy: CameBackBy;
  /** The copy itself, as a `data:` URL, so it travels inside the job file. */
  readonly copy: string;
  /** What kind of file that is, e.g. `image/jpeg` or `application/pdf`. */
  readonly copyType: string;
  /** SHA-256 of the copy, so the picture on the record cannot be swapped. */
  readonly copyHash: string;
  /** Anything the contractor wants on the record. Empty is allowed. */
  readonly note: string;
}

export interface FileBackRequest {
  readonly id: string;
  readonly jobName: string;
  readonly documentId: string;
  readonly documentKind: SignedDocumentKind;
  readonly sentHash: string;
  readonly sentAt: string;
  readonly saysSignedBy: string;
  readonly saysSignedOn: string;
  readonly cameBackAt: string;
  readonly cameBackBy: CameBackBy;
  readonly copy: string;
  readonly note: string;
}

/** The `data:` prefix parsed far enough to name the file's type. */
function typeOf(copy: string): string {
  const match = /^data:([^;,]+)[;,]/.exec(copy);
  return match?.[1] ?? '';
}

/** The date part of a timestamp, for comparing a claimed day to a real one. */
function dayOf(stamp: string): string {
  return stamp.slice(0, 10);
}

/**
 * Files a signed copy against the document it signs, or refuses and says why.
 *
 * `document` is the live document — the proposal or change order as the app
 * holds it right now. It is hashed here and checked against `sentHash`, which
 * is the refusal this whole module exists for: a proposal that has been edited
 * since it was emailed is not the proposal on the signed sheet, and filing the
 * sheet against it would produce a record that looks perfect and is false.
 */
export async function fileSignedBack(
  document: unknown,
  request: FileBackRequest
): Promise<ReturnedDocument> {
  if (!request.saysSignedBy.trim()) {
    throw new CountersignError(
      'Put the name of whoever signed it on the record. A photograph of a mark with no ' +
        'name against it attributes to nobody, which is the one thing this record has to do.'
    );
  }
  if (!request.jobName.trim() || !request.documentId.trim()) {
    throw new CountersignError(
      'A signed copy has to be filed against a job and against the document it signs, or ' +
        'it is a picture in a folder.'
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.saysSignedOn)) {
    throw new CountersignError(
      `"${request.saysSignedOn}" is not a date this can record. Ask them what day they ` +
        'signed it and put that, written as 2026-08-31.'
    );
  }
  if (Number.isNaN(Date.parse(request.cameBackAt)) || Number.isNaN(Date.parse(request.sentAt))) {
    throw new CountersignError('The times on this record are not times this can keep.');
  }
  if (!request.copy.startsWith('data:')) {
    throw new CountersignError(
      'The signed copy itself is missing. Attach the photograph or the PDF they sent back.'
    );
  }
  const copyType = typeOf(request.copy);
  const isImage = copyType.startsWith('image/');
  const isPdf = copyType === 'application/pdf';
  if (!isImage && !isPdf) {
    throw new CountersignError(
      `A signed copy has to be a photograph or a PDF. That file is ${copyType || 'of no ' +
        'kind this can read'}.`
    );
  }
  // The record has to describe the thing it is actually holding. A record that
  // says "a signed PDF" over a photograph is a small lie that a contractor
  // would repeat under oath without knowing he was doing it.
  if (request.cameBackBy === 'photograph' && !isImage) {
    throw new CountersignError(
      'That is not a photograph. Say how it really arrived — the record is only worth ' +
        'keeping if it describes what is in it.'
    );
  }
  if (request.cameBackBy === 'pdf' && !isPdf) {
    throw new CountersignError(
      'That is not a PDF. Say how it really arrived — the record is only worth keeping if ' +
        'it describes what is in it.'
    );
  }
  if (request.saysSignedOn < dayOf(request.sentAt)) {
    throw new CountersignError(
      `This says it was signed on ${request.saysSignedOn}, which is before the document ` +
        `was sent on ${dayOf(request.sentAt)}. Nobody signed a sheet that did not exist ` +
        'yet, so one of those two dates is wrong.'
    );
  }
  if (request.saysSignedOn > dayOf(request.cameBackAt)) {
    throw new CountersignError(
      `This says it was signed on ${request.saysSignedOn}, which is after it came back on ` +
        `${dayOf(request.cameBackAt)}. Check the date they gave you.`
    );
  }
  const hash = await hashOf(document);
  if (hash !== request.sentHash) {
    throw new CountersignError(
      'This is not the document that was sent out. Something in the proposal has changed ' +
        'since it went, so the sheet they signed and the sheet on this phone are two ' +
        'different documents. Filing it here would put their signature against a version ' +
        'they never saw. Send the current one again and get that signed, or put the ' +
        'proposal back the way it was.'
    );
  }
  return {
    id: request.id,
    jobName: request.jobName.trim(),
    documentId: request.documentId.trim(),
    documentKind: request.documentKind,
    sentHash: request.sentHash,
    sentAt: request.sentAt,
    saysSignedBy: request.saysSignedBy.trim(),
    saysSignedOn: request.saysSignedOn,
    cameBackAt: request.cameBackAt,
    cameBackBy: request.cameBackBy,
    copy: request.copy,
    copyType,
    copyHash: await sha256(request.copy),
    note: request.note.trim(),
  };
}

/**
 * Whether the document still matches the one the signed copy was taken from.
 *
 * The same question `verify()` asks of a real signature, asked of this. Run it
 * before showing a job as agreed on the strength of a returned copy: a proposal
 * that has drifted since the sheet was signed is a proposal the sheet does not
 * cover, and the difference belongs in a change order.
 */
export async function checkReturned(
  document: unknown,
  returned: ReturnedDocument
): Promise<Seal> {
  const hash = await hashOf(document);
  if (hash === returned.sentHash) return { ok: true, hash };
  return {
    ok: false,
    hash,
    signed: returned.sentHash,
    why:
      `This is not the ${returned.documentKind} ${returned.saysSignedBy} signed and sent ` +
      `back on ${returned.saysSignedOn}. Something in it has changed since it went out. ` +
      'The version they signed is the one that counts, and the change belongs in a change ' +
      'order.',
  };
}

/**
 * What a returned signed copy actually establishes.
 *
 * Written out for a human, the way `describeSignature` is, and for the same
 * reason: a record nobody can produce and explain is not evidence. The
 * difference is that half of this list is the things it does not establish, and
 * that half is the more important one.
 */
export function whatItProves(returned: ReturnedDocument): string[] {
  return [
    `A ${CAME_BACK_SAYS[returned.cameBackBy]} is on file against this ${returned.documentKind}.`,
    `${returned.saysSignedBy} says they signed it on ${returned.saysSignedOn}.`,
    `It reached you ${returned.cameBackAt.slice(0, 10)} and has been kept since.`,
    `The ${returned.documentKind} that was sent out fingerprints to ` +
      `${returned.sentHash.slice(0, 16)}… (SHA-256), and the copy on file fingerprints to ` +
      `${returned.copyHash.slice(0, 16)}…. Either one changing produces a different ` +
      'fingerprint, so the sheet on this record can be shown to be the sheet that was sent ' +
      'and the picture can be shown not to have been swapped.',
  ];
}

/**
 * What it does not establish, said before anybody has to ask.
 *
 * This list is the point of the module. A contractor holding a photograph
 * believes he holds a signed contract; he holds a photograph, and the gap
 * between those two is where a job goes wrong. Naming the gap costs him
 * nothing today and is the only thing that helps him later.
 */
export function whatItDoesNotProve(returned: ReturnedDocument): string[] {
  return [
    `That ${returned.saysSignedBy} is the person who made the mark. Nobody watched them ` +
      'sign, and this app has not verified anybody’s identity.',
    'That they signed on the day they say. The date on this record is their word for it; ' +
      'the only time this app measured is when the copy arrived.',
    'What they understood themselves to be agreeing to, in their own words, or that they ' +
      'agreed separately to sign electronically. Signing here on the phone records both, ' +
      'sentence by sentence. A photograph records neither.',
    'That the paper they signed is the paper the picture shows. The document is ' +
      'fingerprinted; the sheet in somebody’s kitchen is not.',
  ];
}

/**
 * The one sentence a contractor needs on the screen before he relies on this.
 *
 * Deliberately not softened. The stronger path costs him thirty seconds and a
 * finger on a screen, and the only way he will choose it is if the app is
 * plain about what he is giving up by not.
 */
export const WEAKER_THAN_SIGNING_HERE =
  'A signed copy that comes back is weaker evidence than a signature taken here on the ' +
  'phone. Signing here records the exact words they agreed to, a separate yes to signing ' +
  'electronically, their name beside the mark, the time, the device, and a fingerprint of ' +
  'the document at that moment. A photograph records a mark, and everything else about it ' +
  'is what somebody told you. File this, keep it, and get the on-phone signature too if ' +
  'you can.';

/**
 * The record said out loud, for the sheet and for the screen.
 *
 * Proof and its absence in one list, in that order, because they are one fact.
 */
export function describeReturned(returned: ReturnedDocument): string[] {
  return [
    ...whatItProves(returned),
    'What it does not show:',
    ...whatItDoesNotProve(returned),
    ...(returned.note ? [`Your note: ${returned.note}`] : []),
  ];
}
