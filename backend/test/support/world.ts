// Fixture data for the security tests: six users (two per role), four cases and their documents.
import type { PrismaClient, Role } from '@prisma/client';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stableUuid } from '../../src/import/validate.js';
import { REAL_DATA_DIR } from './data-dir.js';
import { hashPassword, type ScryptParams } from '../../src/modules/auth/password.js';

// Test-only credential for fixture users; not a real secret.
export const PASSWORD = 'Correct-Horse-9-Battery';
export const CHEAP_HASH: ScryptParams = { N: 1024, r: 8, p: 1 }; // fast hashing for tests only

export interface TestUser {
  id: string;
  email: string;
  role: Role;
}

export interface World {
  users: Record<
    'applicantA' | 'applicantB' | 'officerA' | 'officerB' | 'checkerA' | 'checkerB' | 'disabled',
    TestUser
  >;
  // applicantA owns T000001 (IN_REVIEW) and T000003 (SUBMITTED); applicantB owns T000002 (IN_REVIEW)
  // and T000004 (PENDING_CHECKER, recommended by officerA).
  apps: { review: string; otherReview: string; submitted: string; pending: string };
  docs: { reviewPan: string; reviewAadhaar: string; otherReviewPan: string; submittedPan: string };
}

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

export async function createWorld(prisma: PrismaClient): Promise<World> {
  const password_hash = await hashPassword(PASSWORD, CHEAP_HASH);
  const mk = async (key: string, role: Role, is_active = true): Promise<TestUser> => {
    const email = `${key}@test.local`;
    const user = await prisma.user.create({
      data: {
        id: stableUuid('test-user', key),
        email,
        display_name: key,
        role,
        password_hash,
        is_active,
      },
    });
    return { id: user.id, email, role };
  };
  const users = {
    applicantA: await mk('applicant-a', 'APPLICANT'),
    applicantB: await mk('applicant-b', 'APPLICANT'),
    officerA: await mk('officer-a', 'KYC_OFFICER'),
    officerB: await mk('officer-b', 'KYC_OFFICER'),
    checkerA: await mk('checker-a', 'COMPLIANCE_OFFICER'),
    checkerB: await mk('checker-b', 'COMPLIANCE_OFFICER'),
    disabled: await mk('disabled', 'APPLICANT', false),
  };

  // The active rule configuration, exactly as supplied.
  await prisma.ruleConfig.create({
    data: {
      version: '1.0',
      config: JSON.parse(
        readFileSync(join(REAL_DATA_DIR, 'case_02_rules_config_V1.0.json'), 'utf8'),
      ) as object,
      source_file: 'case_02_rules_config_V1.0.json',
      source_sha256: 'f'.repeat(64),
      is_active: true,
    },
  });
  await prisma.occupation.create({
    data: {
      occupation_code: 'SALARIED_PRIVATE',
      description: 'Salaried',
      risk_level: 'LOW',
      source_row_hash: 'x'.repeat(64),
    },
  });

  const app = (
    id: string,
    owner: TestUser,
    status: 'IN_REVIEW' | 'SUBMITTED' | 'PENDING_CHECKER',
    pan: string,
  ) =>
    prisma.application.create({
      data: {
        application_id: id,
        dataset: 'SAMPLE',
        application_date: new Date('2026-03-04'),
        full_name: `Name ${id}`,
        dob: new Date('1990-05-15'),
        gender: 'M',
        pan_number: pan,
        aadhaar_last4: '4821',
        mobile: '9876500000',
        email: `${id.toLowerCase()}@example.com`,
        address: 'Flat 12, Lotus Residency',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
        occupation_code: 'SALARIED_PRIVATE',
        annual_income: 900000,
        status,
        applicant_user_id: owner.id,
      },
    });
  await app('T000001', users.applicantA, 'IN_REVIEW', 'ZZKPS1234Q');
  await app('T000002', users.applicantB, 'IN_REVIEW', 'ZZMPN3456S');
  await app('T000003', users.applicantA, 'SUBMITTED', 'ZZLPI2345R');
  await app('T000004', users.applicantB, 'PENDING_CHECKER', 'ZZTPS9012Y');

  const doc = async (
    docId: string,
    applicationId: string,
    type: 'PAN_CARD' | 'AADHAAR_CARD',
    text: string,
  ) => {
    await prisma.document.create({
      data: {
        doc_id: docId,
        application_id: applicationId,
        file_name: `${docId}.txt`,
        declared_doc_type: type,
        text,
        sha256: sha(text),
        size_bytes: Buffer.byteLength(text),
        dataset: 'SAMPLE',
      },
    });
  };
  await doc(
    'DT000001',
    'T000001',
    'PAN_CARD',
    'INCOME TAX IDENTITY CARD\nZZKPS1234Q\nRAVI KUMAR SHARMA\n',
  );
  await doc('DT000002', 'T000001', 'AADHAAR_CARD', 'AADHAAR\nXXXX XXXX 4821\n');
  await doc(
    'DT000003',
    'T000002',
    'PAN_CARD',
    'INCOME TAX IDENTITY CARD\nZZMPN3456S\nOTHER PERSON\n',
  );
  await doc('DT000004', 'T000003', 'PAN_CARD', 'INCOME TAX IDENTITY CARD\nZZLPI2345R\n');

  const extraction = await prisma.extraction.create({
    data: {
      id: stableUuid('test-extraction', 'DT000001'),
      doc_id: 'DT000001',
      provider: 'MOCK',
      extractor_version: 'test',
    },
  });
  await prisma.extractedField.create({
    data: {
      id: stableUuid('test-field', 'DT000001', 'pan_number'),
      extraction_id: extraction.id,
      doc_id: 'DT000001',
      field_name: 'pan_number',
      value: 'ZZKPS1234Q',
      confidence: 0.93,
    },
  });

  await prisma.officerRecommendation.create({
    data: {
      application_id: 'T000004',
      officer_id: users.officerA.id,
      recommendation: 'APPROVE',
      comment: 'Documents are consistent.',
    },
  });

  return {
    users,
    apps: { review: 'T000001', otherReview: 'T000002', submitted: 'T000003', pending: 'T000004' },
    docs: {
      reviewPan: 'DT000001',
      reviewAadhaar: 'DT000002',
      otherReviewPan: 'DT000003',
      submittedPan: 'DT000004',
    },
  };
}
