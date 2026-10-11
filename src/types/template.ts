export type TemplateCategory =
  | '全部'
  | '商務開發'
  | '專案協作'
  | '客戶服務'
  | '人資招聘'
  | '帳務催款'
  | '會議跟進';

export interface EmailTemplate {
  id: string;
  name: string;
  category: Exclude<TemplateCategory, '全部'>;
  subject: string;
  body: string;
  isPinned?: boolean;
  updatedAt: string;
  sampleValues?: Record<string, string>;
}

export type VariableValuesMap = Record<string, Record<string, string>>;

export interface CopyHistoryEntry {
  id: string;
  templateName: string;
  subject: string;
  body: string;
  copiedAt: string;
  copiedType: 'subject' | 'body' | 'full';
}

export interface BackupPayload {
  version: string;
  exportedAt: string;
  templates: EmailTemplate[];
  variableValues?: VariableValuesMap;
  globalDefaults?: Record<string, string>;
}
