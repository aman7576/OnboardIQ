// File names and column headers exactly as supplied in the data pack (docs/preflight_report.md).

export type DatasetName = 'SAMPLE' | 'EVAL';

export const REFERENCE_FILES = {
  rulesConfig: 'case_02_rules_config_V1.0.json',
  occupations: 'case_02_occupations_V1.0.csv',
  sanctions: 'case_02_sanctions_list_V1.0.csv',
  pep: 'case_02_pep_list_V1.0.csv',
  existingCustomers: 'case_02_existing_customers_V1.0.csv',
} as const;

export function datasetFiles(dataset: DatasetName) {
  const s = dataset === 'SAMPLE' ? 'sample' : 'eval';
  return {
    applications: `case_02_applications_${s}_V1.0.csv`,
    documents: `case_02_documents_${s}_V1.0.csv`,
    documentText: `case_02_document_text_${s}_V1.0.jsonl`,
    extractionMock: `case_02_extraction_mock_${s}_V1.0.csv`,
    // Evaluation data has no truth file (spec section 4).
    truth: dataset === 'SAMPLE' ? `case_02_document_truth_${s}_V1.0.csv` : null,
  };
}

export const COLUMNS = {
  occupations: ['occupation_code', 'description', 'risk_level'],
  sanctions: ['list_id', 'name', 'alias', 'dob', 'nationality', 'program'],
  pep: ['pep_id', 'name', 'dob', 'position', 'category'],
  existingCustomers: ['customer_id', 'full_name', 'pan_number', 'dob'],
  applications: [
    'application_id',
    'application_date',
    'full_name',
    'dob',
    'gender',
    'pan_number',
    'aadhaar_last4',
    'mobile',
    'email',
    'address',
    'city',
    'state',
    'pincode',
    'occupation_code',
    'annual_income',
  ],
  // Present only in the sample file; all five or none.
  applicationsExpected: [
    'expected_decision',
    'expected_reason_codes',
    'expected_name_match_score',
    'expected_risk_category',
    'expected_rekyc_due_date',
  ],
  documents: ['doc_id', 'application_id', 'file_name', 'declared_doc_type'],
  documentText: ['doc_id', 'application_id', 'file_name', 'text'],
  extractionMock: ['doc_id', 'field_name', 'value', 'confidence'],
  truth: [
    'doc_id',
    'doc_type',
    'name',
    'dob',
    'gender',
    'pan_number',
    'aadhaar_last4',
    'address',
    'pincode',
    'document_date',
    'valid_until',
  ],
} as const;

// FR-2 upload limit, also applied to supplied document texts.
export const MAX_DOCUMENT_BYTES = 1024 * 1024;
