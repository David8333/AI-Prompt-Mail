import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Plus,
  Search,
  Copy,
  Check,
  Download,
  Upload,
  Trash2,
  Bookmark,
  RotateCcw,
  Sparkles,
  FileText,
  Mail,
  Calendar,
  Eraser,
  History,
  CheckCircle2,
  AlertCircle,
  X,
  AlignLeft,
  Type,
  Files,
  Brackets,
  Save,
  MousePointerClick,
  Wand2,
  FolderPlus,
  Undo2,
} from 'lucide-react';
import {
  EmailTemplate,
  TemplateCategory,
  VariableValuesMap,
  CopyHistoryEntry,
  BackupPayload,
} from './types/template';
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_CATEGORIES,
  DEFAULT_VARIABLE_CHIPS,
} from './data/defaultTemplates';
import {
  extractVariables,
  getVariableLocations,
  isLikelyMultilineVariable,
  renderPlainText,
  parseTemplateSegments,
} from './utils/templateParser';

const STORAGE_KEYS = {
  TEMPLATES: 'mailforge_templates_v2',
  VALUES: 'mailforge_variable_values_v2',
  ACTIVE_ID: 'mailforge_active_template_id_v2',
  VARIABLE_CHIPS: 'mailforge_variable_chips_v2',
  HISTORY: 'mailforge_copy_history_v1',
};

const REMOVED_CATEGORIES = new Set(['客戶服務', '人資招聘', '帳務催款']);
const REMOVED_TEMPLATE_IDS = new Set([
  'tpl-invoice-reminder',
  'tpl-hr-offer',
  'tpl-customer-incident',
]);

interface ToastMessage {
  id: string;
  type: 'success' | 'warning' | 'error';
  title: string;
  detail?: string;
}

export default function App() {
  // 1. Persistent Templates State — Filters out removed categories/templates & respects empty array []
  const [templates, setTemplates] = useState<EmailTemplate[]>(() => {
    try {
      const saved =
        localStorage.getItem(STORAGE_KEYS.TEMPLATES) ??
        localStorage.getItem('mailforge_templates_v1');
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed
            .filter(
              (tpl: EmailTemplate) =>
                !REMOVED_TEMPLATE_IDS.has(tpl.id) &&
                !REMOVED_CATEGORIES.has(tpl.category)
            )
            .map((tpl: EmailTemplate) => ({
              ...tpl,
              category: (TEMPLATE_CATEGORIES.includes(tpl.category as TemplateCategory) &&
              tpl.category !== '全部'
                ? tpl.category
                : '商務開發') as Exclude<TemplateCategory, '全部'>,
            }));
        }
      }
    } catch (e) {
      console.error('Failed to read templates from localStorage:', e);
    }
    return DEFAULT_TEMPLATES;
  });

  // 2. Active Template ID
  const [activeTemplateId, setActiveTemplateId] = useState<string>(() => {
    try {
      const savedId =
        localStorage.getItem(STORAGE_KEYS.ACTIVE_ID) ??
        localStorage.getItem('mailforge_active_template_id_v1');
      if (savedId && !REMOVED_TEMPLATE_IDS.has(savedId)) return savedId;
    } catch {
      // ignore
    }
    return DEFAULT_TEMPLATES[0]?.id || '';
  });

  // 3. Per-Template Variable Values Map
  const [variableValuesMap, setVariableValuesMap] = useState<VariableValuesMap>(() => {
    try {
      const saved =
        localStorage.getItem(STORAGE_KEYS.VALUES) ??
        localStorage.getItem('mailforge_variable_values_v1');
      if (saved !== null) {
        return JSON.parse(saved) || {};
      }
    } catch (e) {
      console.error('Failed to read variable values from localStorage:', e);
    }
    const initialMap: VariableValuesMap = {};
    DEFAULT_TEMPLATES.forEach((tpl) => {
      if (tpl.sampleValues) {
        initialMap[tpl.id] = { ...tpl.sampleValues };
      }
    });
    return initialMap;
  });

  // 4. Unified Editable Variable Chips (Can both ADD and DELETE any variable chip!)
  const [variableChips, setVariableChips] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.VARIABLE_CHIPS);
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return DEFAULT_VARIABLE_CHIPS;
  });

  // 5. Copy History State
  const [copyHistory, setCopyHistory] = useState<CopyHistoryEntry[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.HISTORY);
      if (saved) return JSON.parse(saved) || [];
    } catch {
      // ignore
    }
    return [];
  });

  // Undo buffer for recently deleted template(s)
  const [lastDeletedBackup, setLastDeletedBackup] = useState<{
    templates: EmailTemplate[];
    label: string;
  } | null>(null);

  // UI & Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<TemplateCategory>('全部');
  const [mobileTab, setMobileTab] = useState<'templates' | 'design' | 'fillAndPreview'>('design');
  const [highlightVariables, setHighlightVariables] = useState<boolean>(true);
  const [focusedVariable, setFocusedVariable] = useState<string | null>(null);
  const [customMultilineVars, setCustomMultilineVars] = useState<Record<string, boolean>>({});
  const [customVarInput, setCustomVarInput] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [ccEmail, setCcEmail] = useState('');

  // Copy & Save feedback states
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [savedFeedbackId, setSavedFeedbackId] = useState<string | null>(null);
  const [lastSavedTime, setLastSavedTime] = useState<string>(() =>
    new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  );
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Modals & Confirmation States
  const [showResetModal, setShowResetModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showNewTemplateModal, setShowNewTemplateModal] = useState(false);
  const [newTplName, setNewTplName] = useState('');
  const [newTplCategory, setNewTplCategory] = useState<Exclude<TemplateCategory, '全部'>>('商務開發');
  const [newTplMode, setNewTplMode] = useState<'blank' | 'starter'>('blank');
  const [importPendingData, setImportPendingData] = useState<BackupPayload | null>(null);

  // Cursor & Selection Tracking for Variable Box Insertion
  const [lastFocusedField, setLastFocusedField] = useState<'subject' | 'body'>('body');
  const [selectedTextInfo, setSelectedTextInfo] = useState<{
    field: 'subject' | 'body';
    text: string;
    start: number;
    end: number;
  } | null>(null);

  const templateNameInputRef = useRef<HTMLInputElement | null>(null);
  const subjectInputRef = useRef<HTMLInputElement | null>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const variableInputRefs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({});
  const selectionRef = useRef<{ field: 'subject' | 'body'; start: number; end: number }>({
    field: 'body',
    start: 0,
    end: 0,
  });

  // Sync to localStorage automatically
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify(templates));
      setLastSavedTime(
        new Date().toLocaleTimeString('zh-TW', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    } catch (e) {
      console.error('Failed to save templates:', e);
    }
  }, [templates]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.VALUES, JSON.stringify(variableValuesMap));
    } catch (e) {
      console.error('Failed to save variable values:', e);
    }
  }, [variableValuesMap]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_ID, activeTemplateId);
    } catch {
      // ignore
    }
  }, [activeTemplateId]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.VARIABLE_CHIPS, JSON.stringify(variableChips));
    } catch {
      // ignore
    }
  }, [variableChips]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(copyHistory.slice(0, 25)));
    } catch {
      // ignore
    }
  }, [copyHistory]);

  // Helper to show toast
  const pushToast = (
    title: string,
    detail?: string,
    type: 'success' | 'warning' | 'error' = 'success'
  ) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-2), { id, title, detail, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  };

  // Ensure activeTemplate points to a valid template (or null if library is empty)
  const activeTemplate = useMemo(() => {
    if (templates.length === 0) return null;
    return templates.find((t) => t.id === activeTemplateId) || templates[0] || null;
  }, [templates, activeTemplateId]);

  // Filtered & sorted templates
  const filteredTemplates = useMemo(() => {
    return templates
      .filter((tpl) => {
        const matchesCat =
          selectedCategory === '全部' || tpl.category === selectedCategory;
        const q = searchQuery.trim().toLowerCase();
        if (!q) return matchesCat;
        const matchesQuery =
          tpl.name.toLowerCase().includes(q) ||
          tpl.subject.toLowerCase().includes(q) ||
          tpl.body.toLowerCase().includes(q) ||
          tpl.category.toLowerCase().includes(q);
        return matchesCat && matchesQuery;
      })
      .sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }, [templates, selectedCategory, searchQuery]);

  // Extracted variables for active template
  const detectedVariables = useMemo(() => {
    if (!activeTemplate) return [];
    return extractVariables(activeTemplate.subject, activeTemplate.body);
  }, [activeTemplate]);

  // Current variable values for active template
  const currentValues = useMemo(() => {
    if (!activeTemplate) return {};
    return variableValuesMap[activeTemplate.id] || {};
  }, [activeTemplate, variableValuesMap]);

  // Count how many detected variables are filled
  const filledCount = useMemo(() => {
    return detectedVariables.filter(
      (v) => currentValues[v] !== undefined && currentValues[v].trim() !== ''
    ).length;
  }, [detectedVariables, currentValues]);

  // Rendered plain text for Subject and Body (Do not keep [變數框] when unfilled)
  const renderedSubject = useMemo(() => {
    if (!activeTemplate) return '';
    return renderPlainText(activeTemplate.subject, currentValues, false);
  }, [activeTemplate, currentValues]);

  const renderedBody = useMemo(() => {
    if (!activeTemplate) return '';
    return renderPlainText(activeTemplate.body, currentValues, false);
  }, [activeTemplate, currentValues]);

  // Parsed segments for rich preview
  const subjectSegments = useMemo(() => {
    if (!activeTemplate) return [];
    return parseTemplateSegments(activeTemplate.subject, currentValues);
  }, [activeTemplate, currentValues]);

  const bodySegments = useMemo(() => {
    if (!activeTemplate) return [];
    return parseTemplateSegments(activeTemplate.body, currentValues);
  }, [activeTemplate, currentValues]);

  // Update active template fields
  const updateActiveTemplate = (patch: Partial<EmailTemplate>) => {
    if (!activeTemplate) return;
    const now = new Date().toISOString();
    setTemplates((prev) =>
      prev.map((tpl) =>
        tpl.id === activeTemplate.id ? { ...tpl, ...patch, updatedAt: now } : tpl
      )
    );
  };

  // Explicit Save Single Template handler
  const handleSaveSingleTemplate = (tpl: EmailTemplate, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const now = new Date().toISOString();
      const currentFilled = variableValuesMap[tpl.id] || {};
      const updatedList = templates.map((item) =>
        item.id === tpl.id
          ? {
              ...item,
              updatedAt: now,
              sampleValues: { ...(item.sampleValues || {}), ...currentFilled },
            }
          : item
      );
      setTemplates(updatedList);
      localStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify(updatedList));
      localStorage.setItem(STORAGE_KEYS.VALUES, JSON.stringify(variableValuesMap));
      setSavedFeedbackId(tpl.id);
      setTimeout(() => {
        setSavedFeedbackId((prev) => (prev === tpl.id ? null : prev));
      }, 2000);
      pushToast('已儲存範本', `「${tpl.name || '未命名範本'}」與目前變數內容已完整儲存至範本庫`);
    } catch {
      pushToast('儲存失敗', '請檢查瀏覽器儲存空間設定', 'error');
    }
  };

  // Save current template as a brand new template in the library ("另存為新範本")
  const handleSaveAsNewTemplate = () => {
    if (!activeTemplate) return;
    const newId = `tpl-${Date.now()}`;
    const currentFilled = variableValuesMap[activeTemplate.id] || {};
    const cloned: EmailTemplate = {
      ...activeTemplate,
      id: newId,
      name: `${activeTemplate.name || '自訂範本'} (另存新檔)`,
      isPinned: false,
      updatedAt: new Date().toISOString(),
      sampleValues: { ...(activeTemplate.sampleValues || {}), ...currentFilled },
    };
    const nextList = [cloned, ...templates];
    setTemplates(nextList);
    setVariableValuesMap((prev) => ({
      ...prev,
      [newId]: { ...currentFilled },
    }));
    setActiveTemplateId(newId);
    pushToast('已另存為新範本', `已新增「${cloned.name}」至左側範本庫`);
  };

  // Delete ANY template in the library
  const handleDeleteTemplate = (tplId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const target = templates.find((t) => t.id === tplId);
    if (!target) return;

    setLastDeletedBackup({
      templates: [...templates],
      label: target.name || '未命名範本',
    });

    const remaining = templates.filter((t) => t.id !== tplId);
    setTemplates(remaining);

    if (activeTemplateId === tplId) {
      setActiveTemplateId(remaining[0]?.id || '');
    }

    pushToast(
      `已刪除「${target.name || '未命名範本'}」`,
      remaining.length === 0
        ? '範本庫已清空，您可隨時點擊「新增空白範本」或「復原刪除」'
        : '若誤刪可點擊左側「復原刪除」按鈕還原'
    );
  };

  // Undo last delete
  const handleUndoDelete = () => {
    if (!lastDeletedBackup) return;
    setTemplates(lastDeletedBackup.templates);
    if (lastDeletedBackup.templates.length > 0 && !activeTemplateId) {
      setActiveTemplateId(lastDeletedBackup.templates[0].id);
    }
    pushToast('已復原刪除的範本', `已還原「${lastDeletedBackup.label}」`);
    setLastDeletedBackup(null);
  };

  // Update a specific variable value for the active template
  const handleVariableChange = (varName: string, val: string) => {
    if (!activeTemplate) return;
    setVariableValuesMap((prev) => ({
      ...prev,
      [activeTemplate.id]: {
        ...(prev[activeTemplate.id] || {}),
        [varName]: val,
      },
    }));
  };

  // Remove a [變數框] token from the active template's Subject and Body
  const handleRemoveVariableFromTemplate = (varName: string) => {
    if (!activeTemplate) return;
    const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\[\\s*${escaped}\\s*\\]`, 'g');
    updateActiveTemplate({
      subject: activeTemplate.subject.replace(regex, ''),
      body: activeTemplate.body.replace(regex, ''),
    });
    pushToast(`已從範本移除 [${varName}]`, '已同步從主旨與內文中刪除該變數框');
  };

  // Open New Template Creation Modal
  const openNewTemplateDialog = (defaultMode: 'blank' | 'starter' = 'blank') => {
    setNewTplName('');
    setNewTplCategory(selectedCategory !== '全部' ? selectedCategory : '商務開發');
    setNewTplMode(defaultMode);
    setShowNewTemplateModal(true);
  };

  // Confirm creating a brand new template
  const handleCreateTemplateConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    const newId = `tpl-${Date.now()}`;
    const finalName = newTplName.trim() || `自訂郵件範本 ${templates.length + 1}`;

    const newTemplate: EmailTemplate =
      newTplMode === 'blank'
        ? {
            id: newId,
            name: finalName,
            category: newTplCategory,
            subject: '',
            body: '',
            isPinned: false,
            updatedAt: new Date().toISOString(),
            sampleValues: {},
          }
        : {
            id: newId,
            name: finalName,
            category: newTplCategory,
            subject: '【[郵件主旨類別]】[公司名稱] — [事項名稱]',
            body: `[收件人姓名] 您好：

這邊與您確認關於「[事項名稱]」的相關細節：

[固定文字段落或說明內容]

請於 [截止日期] 前回覆確認，謝謝您的協助！

順頌 商祺

[寄件人姓名]`,
            isPinned: false,
            updatedAt: new Date().toISOString(),
            sampleValues: {},
          };

    setTemplates((prev) => [newTemplate, ...prev]);
    setActiveTemplateId(newId);
    setShowNewTemplateModal(false);
    setMobileTab('design');

    requestAnimationFrame(() => {
      if (subjectInputRef.current) {
        subjectInputRef.current.focus();
      }
    });

    pushToast(
      `已建立並儲存「${finalName}」`,
      newTplMode === 'blank'
        ? '現在您可以自由編寫固定文字，並隨時點擊「+ 插入變數框」'
        : '已載入基礎信件框架，您可自由修改固定文字與變數框'
    );
  };

  // Quick Direct Blank Template Creation
  const handleQuickBlankTemplate = () => {
    const newId = `tpl-${Date.now()}`;
    const defaultCategory: Exclude<TemplateCategory, '全部'> =
      selectedCategory !== '全部' ? selectedCategory : '商務開發';
    const newTemplate: EmailTemplate = {
      id: newId,
      name: `自訂範本 ${templates.length + 1}`,
      category: defaultCategory,
      subject: '',
      body: '',
      isPinned: false,
      updatedAt: new Date().toISOString(),
      sampleValues: {},
    };
    setTemplates((prev) => [newTemplate, ...prev]);
    setActiveTemplateId(newId);
    setMobileTab('design');
    requestAnimationFrame(() => {
      if (templateNameInputRef.current) {
        templateNameInputRef.current.focus();
        templateNameInputRef.current.select();
      }
    });
    pushToast('已新增空白範本', '請編寫您的固定文字，並點擊按鈕插入 [變數框]');
  };

  // Duplicate template
  const handleDuplicateTemplate = (tpl: EmailTemplate, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const copyId = `tpl-${Date.now()}`;
    const duplicated: EmailTemplate = {
      ...tpl,
      id: copyId,
      name: `${tpl.name} (副本)`,
      isPinned: false,
      updatedAt: new Date().toISOString(),
    };
    setTemplates((prev) => [duplicated, ...prev]);
    if (variableValuesMap[tpl.id]) {
      setVariableValuesMap((prev) => ({
        ...prev,
        [copyId]: { ...prev[tpl.id] },
      }));
    }
    setActiveTemplateId(copyId);
    setMobileTab('design');
    pushToast('已複製並儲存範本', `已建立「${duplicated.name}」`);
  };

  // Toggle Pin
  const handleTogglePin = (tplId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setTemplates((prev) =>
      prev.map((t) => (t.id === tplId ? { ...t, isPinned: !t.isPinned } : t))
    );
  };

  // Record cursor position and text selection in Subject or Body
  const handleRecordSelection = (field: 'subject' | 'body') => {
    setLastFocusedField(field);
    if (field === 'subject' && subjectInputRef.current) {
      const start = subjectInputRef.current.selectionStart ?? subjectInputRef.current.value.length;
      const end = subjectInputRef.current.selectionEnd ?? subjectInputRef.current.value.length;
      selectionRef.current = { field: 'subject', start, end };
      if (end > start) {
        const selected = subjectInputRef.current.value.slice(start, end).trim();
        if (selected && !selected.includes('[') && !selected.includes(']') && selected.length <= 30) {
          setSelectedTextInfo({ field: 'subject', text: selected, start, end });
          return;
        }
      }
      setSelectedTextInfo(null);
    } else if (field === 'body' && bodyTextareaRef.current) {
      const start = bodyTextareaRef.current.selectionStart ?? bodyTextareaRef.current.value.length;
      const end = bodyTextareaRef.current.selectionEnd ?? bodyTextareaRef.current.value.length;
      selectionRef.current = { field: 'body', start, end };
      if (end > start) {
        const selected = bodyTextareaRef.current.value.slice(start, end).trim();
        if (selected && !selected.includes('[') && !selected.includes(']') && !selected.includes('\n') && selected.length <= 30) {
          setSelectedTextInfo({ field: 'body', text: selected, start, end });
          return;
        }
      }
      setSelectedTextInfo(null);
    }
  };

  // Convert highlighted text in Subject or Body into a [變數框]
  const handleConvertSelectionToVariable = () => {
    if (!activeTemplate || !selectedTextInfo) return;
    const { field, text, start, end } = selectedTextInfo;
    const cleanName = text.replace(/[\[\]]/g, '').trim();
    if (!cleanName) return;

    const token = `[${cleanName}]`;
    if (field === 'subject') {
      const current = activeTemplate.subject;
      const nextSubject = current.slice(0, start) + token + current.slice(end);
      updateActiveTemplate({ subject: nextSubject });
    } else {
      const current = activeTemplate.body;
      const nextBody = current.slice(0, start) + token + current.slice(end);
      updateActiveTemplate({ body: nextBody });
    }

    if (!variableChips.includes(cleanName)) {
      setVariableChips((prev) => [cleanName, ...prev]);
    }
    handleVariableChange(cleanName, cleanName);
    setSelectedTextInfo(null);
    pushToast(`已將「${cleanName}」轉為變數框`, `已自動建立 ${token} 填空欄位並加入變數框列表`);
  };

  // Insert [變數名稱] at cursor position in active field (Subject or Body)
  const insertVariableAtCursor = (rawVarName: string, targetFieldOverride?: 'subject' | 'body') => {
    if (!activeTemplate) return;
    const cleanName = rawVarName.replace(/[\[\]]/g, '').trim();
    if (!cleanName) return;

    const token = `[${cleanName}]`;
    const targetField = targetFieldOverride || lastFocusedField;

    if (targetField === 'subject') {
      const currentText = activeTemplate.subject;
      const start =
        selectionRef.current.field === 'subject'
          ? Math.min(selectionRef.current.start, currentText.length)
          : currentText.length;
      const end =
        selectionRef.current.field === 'subject'
          ? Math.min(selectionRef.current.end, currentText.length)
          : currentText.length;

      const nextSubject =
        currentText.slice(0, start) + token + currentText.slice(end);
      updateActiveTemplate({ subject: nextSubject });

      requestAnimationFrame(() => {
        if (subjectInputRef.current) {
          subjectInputRef.current.focus();
          const newCursor = start + token.length;
          subjectInputRef.current.setSelectionRange(newCursor, newCursor);
          selectionRef.current = { field: 'subject', start: newCursor, end: newCursor };
        }
      });
    } else {
      const currentText = activeTemplate.body;
      const start =
        selectionRef.current.field === 'body'
          ? Math.min(selectionRef.current.start, currentText.length)
          : currentText.length;
      const end =
        selectionRef.current.field === 'body'
          ? Math.min(selectionRef.current.end, currentText.length)
          : currentText.length;

      const nextBody =
        currentText.slice(0, start) + token + currentText.slice(end);
      updateActiveTemplate({ body: nextBody });

      requestAnimationFrame(() => {
        if (bodyTextareaRef.current) {
          bodyTextareaRef.current.focus();
          const newCursor = start + token.length;
          bodyTextareaRef.current.setSelectionRange(newCursor, newCursor);
          selectionRef.current = { field: 'body', start: newCursor, end: newCursor };
        }
      });
    }

    pushToast(
      `已插入變數框 ${token}`,
      `已插入至${targetField === 'subject' ? '「郵件主旨」' : '「郵件內文」'}游標位置，右側已同步生成填空欄`
    );
  };

  // Add custom variable chip AND insert into template
  const handleAddAndInsertCustomVariable = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = customVarInput.replace(/[\[\]]/g, '').trim();
    if (!clean) return;
    if (!variableChips.includes(clean)) {
      setVariableChips((prev) => [clean, ...prev]);
    }
    insertVariableAtCursor(clean);
    setCustomVarInput('');
  };

  // Add custom variable chip to library only
  const handleAddChipOnly = () => {
    const clean = customVarInput.replace(/[\[\]]/g, '').trim();
    if (!clean) return;
    if (!variableChips.includes(clean)) {
      setVariableChips((prev) => [clean, ...prev]);
      pushToast(`已新增自訂變數框 [${clean}]`, '點擊下方標籤即可隨時插入至游標處');
    } else {
      pushToast(`變數框 [${clean}] 已存在`, '可直接點擊下方標籤插入', 'warning');
    }
    setCustomVarInput('');
  };

  // Delete ANY variable chip from the toolbar
  const handleDeleteVariableChip = (chipName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setVariableChips((prev) => prev.filter((c) => c !== chipName));
    pushToast(`已刪除變數框標籤 [${chipName}]`, '已從常用變數框工具列移除');
  };

  // Insert fixed boilerplate text snippet into Body
  const insertFixedSnippet = (snippetText: string) => {
    if (!activeTemplate) return;
    const currentText = activeTemplate.body;
    const prefix = currentText.trim().length > 0 ? '\n\n' : '';
    const nextBody = currentText + prefix + snippetText;
    updateActiveTemplate({ body: nextBody });
    requestAnimationFrame(() => {
      if (bodyTextareaRef.current) {
        bodyTextareaRef.current.focus();
        bodyTextareaRef.current.setSelectionRange(nextBody.length, nextBody.length);
        selectionRef.current = { field: 'body', start: nextBody.length, end: nextBody.length };
      }
    });
  };

  // Fill Sample Values for current template
  const handleFillSampleValues = () => {
    if (!activeTemplate) return;
    const todayStr = new Date().toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    const nextVals: Record<string, string> = { ...(currentValues || {}) };
    detectedVariables.forEach((v) => {
      if (activeTemplate.sampleValues && activeTemplate.sampleValues[v]) {
        nextVals[v] = activeTemplate.sampleValues[v];
      } else if (v.includes('日期')) {
        nextVals[v] = todayStr;
      } else if (v.includes('時間')) {
        nextVals[v] = '14:30';
      } else if (v.includes('姓名')) {
        nextVals[v] = '林經理';
      } else if (v.includes('公司')) {
        nextVals[v] = '星宇科技股份有限公司';
      } else {
        nextVals[v] = `範例${v}`;
      }
    });

    setVariableValuesMap((prev) => ({
      ...prev,
      [activeTemplate.id]: nextVals,
    }));
    pushToast('已帶入預設值', '所有變數欄位已填入範例內容');
  };

  // Save current filled values as template's default sampleValues
  const handleSaveCurrentAsTemplateDefaults = () => {
    if (!activeTemplate) return;
    updateActiveTemplate({
      sampleValues: { ...currentValues },
    });
    pushToast('已儲存為此範本預設值', '之後點擊「帶入預設值」即可一鍵還原目前填寫內容');
  };

  // Clear all variable inputs for current template
  const handleClearVariables = () => {
    if (!activeTemplate) return;
    setVariableValuesMap((prev) => ({
      ...prev,
      [activeTemplate.id]: {},
    }));
    pushToast('已清空變數填空', '所有變數框輸入值已重設為空白');
  };

  // Fill date variables with today's date
  const handleFillTodayDate = () => {
    if (!activeTemplate) return;
    const todayStr = new Date().toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const nextVals = { ...currentValues };
    let count = 0;
    detectedVariables.forEach((v) => {
      if (v.includes('日期') || v.includes('時間') || v.toLowerCase().includes('date')) {
        nextVals[v] = todayStr;
        count++;
      }
    });
    if (count === 0 && focusedVariable) {
      nextVals[focusedVariable] = todayStr;
      count = 1;
    }
    setVariableValuesMap((prev) => ({
      ...prev,
      [activeTemplate.id]: nextVals,
    }));
    pushToast(
      count > 0 ? `已填入今日日期 (${todayStr})` : `今日日期：${todayStr}`,
      count > 0 ? `已自動更新 ${count} 個日期相關變數` : '您可於任一日期變數框填入'
    );
  };

  // Click a variable in the live preview to jump directly to its input field
  const handlePreviewVariableClick = (varName: string) => {
    setFocusedVariable(varName);
    const el = variableInputRefs.current[varName];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus();
    }
  };

  // Copy helper with clipboard fallback & history log
  const handleCopyText = async (
    text: string,
    key: 'subject' | 'body' | 'full',
    label: string
  ) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }

      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 2200);

      if (activeTemplate) {
        const entry: CopyHistoryEntry = {
          id: `hist-${Date.now()}`,
          templateName: activeTemplate.name,
          subject: renderedSubject,
          body: renderedBody,
          copiedAt: new Date().toISOString(),
          copiedType: key,
        };
        setCopyHistory((prev) => [entry, ...prev.slice(0, 24)]);
      }

      const unfilledCount = detectedVariables.length - filledCount;
      if (unfilledCount > 0) {
        pushToast(
          `已複製${label}`,
          `提醒：尚有 ${unfilledCount} 個變數框未填寫內容`,
          'warning'
        );
      } else {
        pushToast(`已成功複製${label}`, '可直接貼上至您的郵件軟體');
      }
    } catch (err) {
      console.error('Copy failed:', err);
      pushToast('複製失敗', '請檢查瀏覽器剪貼簿權限', 'error');
    }
  };

  // Export JSON Backup
  const handleExportJSON = () => {
    const payload: BackupPayload = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      templates,
      variableValues: variableValuesMap,
    };
    const jsonString = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const dateStamp = new Date().toISOString().slice(0, 10);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mailforge-templates-backup-${dateStamp}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    pushToast(
      '已匯出 JSON 備份檔',
      `共打包 ${templates.length} 組郵件範本與變數設定`
    );
  };

  // Trigger file input for Import JSON
  const handleImportClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  // Parse uploaded JSON file
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);

        let importedTemplates: EmailTemplate[] = [];
        let importedValues: VariableValuesMap = {};

        if (Array.isArray(parsed)) {
          importedTemplates = parsed;
        } else if (parsed && Array.isArray(parsed.templates)) {
          importedTemplates = parsed.templates;
          if (parsed.variableValues && typeof parsed.variableValues === 'object') {
            importedValues = parsed.variableValues;
          }
        } else {
          throw new Error('Invalid JSON structure');
        }

        const validTemplates = importedTemplates
          .filter(
            (t) =>
              t &&
              typeof t.name === 'string' &&
              typeof t.subject === 'string' &&
              typeof t.body === 'string'
          )
          .map((t, idx) => ({
            id: t.id || `imported-${Date.now()}-${idx}`,
            name: t.name,
            category: (TEMPLATE_CATEGORIES.includes(t.category as TemplateCategory) &&
            t.category !== '全部'
              ? t.category
              : '商務開發') as Exclude<TemplateCategory, '全部'>,
            subject: t.subject,
            body: t.body,
            isPinned: Boolean(t.isPinned),
            updatedAt: t.updatedAt || new Date().toISOString(),
            sampleValues: t.sampleValues || {},
          }));

        if (validTemplates.length === 0) {
          pushToast('匯入失敗', 'JSON 檔案中未找到有效的郵件範本結構', 'error');
          return;
        }

        setImportPendingData({
          version: '1.0.0',
          exportedAt: new Date().toISOString(),
          templates: validTemplates,
          variableValues: importedValues,
        });
      } catch (err) {
        console.error('JSON Import Error:', err);
        pushToast('檔案格式錯誤', '請確認上傳的檔案為有效的 JSON 備份檔', 'error');
      }
    };
    reader.readAsText(file);
  };

  // Apply imported JSON (Merge or Replace)
  const applyImportData = (mode: 'merge' | 'replace') => {
    if (!importPendingData) return;
    const incoming = importPendingData.templates;
    const incomingValues = importPendingData.variableValues || {};

    if (mode === 'replace') {
      setTemplates(incoming);
      setVariableValuesMap(incomingValues);
      setActiveTemplateId(incoming[0].id);
      pushToast('已覆蓋匯入範本', `成功載入 ${incoming.length} 組郵件範本`);
    } else {
      setTemplates((prev) => {
        const map = new Map<string, EmailTemplate>();
        prev.forEach((t) => map.set(t.id, t));
        incoming.forEach((t) => map.set(t.id, t));
        return Array.from(map.values());
      });
      setVariableValuesMap((prev) => ({
        ...prev,
        ...incomingValues,
      }));
      setActiveTemplateId(incoming[0].id);
      pushToast('已合併匯入範本', `已整合 ${incoming.length} 組郵件範本至現有資料庫`);
    }
    setImportPendingData(null);
  };

  // Reset to built-in default templates
  const handleConfirmResetDefaults = () => {
    setTemplates(DEFAULT_TEMPLATES);
    const initialMap: VariableValuesMap = {};
    DEFAULT_TEMPLATES.forEach((tpl) => {
      if (tpl.sampleValues) {
        initialMap[tpl.id] = { ...tpl.sampleValues };
      }
    });
    setVariableValuesMap(initialMap);
    setActiveTemplateId(DEFAULT_TEMPLATES[0].id);
    setShowResetModal(false);
    pushToast('已還原預設範本庫', '所有預設範本與範例資料已重新載入');
  };

  // Open in default mail client via mailto:
  const mailtoHref = useMemo(() => {
    const params = new URLSearchParams();
    if (ccEmail.trim()) params.set('cc', ccEmail.trim());
    if (renderedSubject) params.set('subject', renderedSubject);
    if (renderedBody) params.set('body', renderedBody);
    const queryStr = params.toString().replace(/\+/g, '%20');
    return `mailto:${encodeURIComponent(recipientEmail.trim())}${
      queryStr ? `?${queryStr}` : ''
    }`;
  }, [recipientEmail, ccEmail, renderedSubject, renderedBody]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Hidden file input for JSON Import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-8 px-4 sm:px-6 py-3.5 bg-white border-b border-slate-200">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setMobileTab('design');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          MailForge
        </a>

        {/* Zone 2: 4 concise single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <button
            type="button"
            onClick={handleQuickBlankTemplate}
            className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            新增空白範本
          </button>
          <button
            type="button"
            onClick={() => setShowHistoryModal(true)}
            className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            複製紀錄
          </button>
          <button
            type="button"
            onClick={handleImportClick}
            className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            匯入 JSON
          </button>
          <button
            type="button"
            onClick={handleExportJSON}
            className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            匯出備份
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => openNewTemplateDialog('blank')}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 active:scale-[0.99] transition-all whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            新增自訂範本
          </button>
        </div>
      </header>

      {/* Mobile & Tablet Segmented Switcher (Only visible below xl breakpoint) */}
      <div className="xl:hidden bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setMobileTab('templates')}
            className={`flex-1 sm:flex-initial px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              mobileTab === 'templates'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            1. 範本庫 ({templates.length})
          </button>
          <button
            type="button"
            onClick={() => setMobileTab('design')}
            className={`flex-1 sm:flex-initial px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              mobileTab === 'design'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            2. 編寫文字與變數框
          </button>
          <button
            type="button"
            onClick={() => setMobileTab('fillAndPreview')}
            className={`flex-1 sm:flex-initial px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              mobileTab === 'fillAndPreview'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            3. 填寫變數與預覽 ({filledCount}/{detectedVariables.length})
          </button>
        </div>
      </div>

      {/* Main Responsive 3-Column Studio Grid */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-5">
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* ====================================================================
              COLUMN 1 (Left, 3 cols): 郵件範本庫
             ==================================================================== */}
          <aside
            className={`xl:col-span-3 bg-white border border-slate-200 rounded-xl flex flex-col overflow-hidden ${
              mobileTab === 'templates' ? 'block' : 'hidden xl:flex'
            }`}
          >
            {/* Sidebar Header */}
            <div className="p-4 border-b border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    我的郵件範本庫
                  </h2>
                  <p className="text-[11px] text-slate-500 tabular-nums mt-0.5">
                    共 {templates.length} 組 · 自動儲存 ({lastSavedTime})
                  </p>
                </div>

                {lastDeletedBackup && (
                  <button
                    type="button"
                    onClick={handleUndoDelete}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    title={`還原剛刪除的「${lastDeletedBackup.label}」`}
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    復原刪除
                  </button>
                )}
              </div>

              {/* Create New Template Row */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleQuickBlankTemplate}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  新增空白範本
                </button>
                <button
                  type="button"
                  onClick={() => openNewTemplateDialog('starter')}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  引導建立範本
                </button>
              </div>

              {/* Search Input */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜尋範本名稱、主旨或固定文字..."
                  className="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-indigo-600 transition-colors"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    title="清除搜尋"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Interactive Category Filter Controls */}
              <div className="flex items-center gap-1 overflow-x-auto pb-1 no-scrollbar">
                {TEMPLATE_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      selectedCategory === cat
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Template List — Every template has always-visible Save & Delete buttons */}
            <div className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto">
              {templates.length === 0 ? (
                <div className="p-8 text-center space-y-3">
                  <p className="text-sm font-semibold text-slate-800">
                    範本庫目前已清空
                  </p>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    請點擊下方按鈕建立您的專屬郵件範本，或還原系統預設範本。
                  </p>
                  <div className="flex flex-col gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleQuickBlankTemplate}
                      className="w-full py-2 px-3 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors cursor-pointer"
                    >
                      + 新增第一個空白範本
                    </button>
                    {lastDeletedBackup && (
                      <button
                        type="button"
                        onClick={handleUndoDelete}
                        className="w-full py-2 px-3 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors cursor-pointer"
                      >
                        復原剛才刪除的範本
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleConfirmResetDefaults}
                      className="w-full py-2 px-3 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                    >
                      載入系統預設範本
                    </button>
                  </div>
                </div>
              ) : filteredTemplates.length === 0 ? (
                <div className="p-8 text-center space-y-3">
                  <p className="text-xs text-slate-500">
                    找不到符合篩選條件的郵件範本
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setSelectedCategory('全部');
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
                  >
                    顯示全部範本
                  </button>
                </div>
              ) : (
                filteredTemplates.map((tpl) => {
                  const isSelected = activeTemplate?.id === tpl.id;
                  const varCount = extractVariables(tpl.subject, tpl.body).length;
                  const isJustSaved = savedFeedbackId === tpl.id;

                  return (
                    <div
                      key={tpl.id}
                      onClick={() => {
                        setActiveTemplateId(tpl.id);
                        if (window.innerWidth < 1280) {
                          setMobileTab('design');
                        }
                      }}
                      className={`p-3.5 transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-50/80'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h3
                          className={`text-sm font-semibold leading-snug line-clamp-1 ${
                            isSelected ? 'text-indigo-950' : 'text-slate-900'
                          }`}
                        >
                          {tpl.name || '未命名範本'}
                        </h3>

                        {/* Always-visible Pin, Save, Duplicate, and Delete buttons */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => handleTogglePin(tpl.id, e)}
                            title={tpl.isPinned ? '取消釘選' : '釘選常用範本'}
                            className={`p-1 rounded hover:bg-white transition-colors cursor-pointer ${
                              tpl.isPinned
                                ? 'text-amber-500'
                                : 'text-slate-400 hover:text-slate-700'
                            }`}
                          >
                            <Bookmark
                              className="w-3.5 h-3.5"
                              fill={tpl.isPinned ? 'currentColor' : 'none'}
                            />
                          </button>

                          <button
                            type="button"
                            onClick={(e) => handleSaveSingleTemplate(tpl, e)}
                            title="儲存此範本"
                            className={`px-1.5 py-0.5 text-[11px] font-medium rounded border transition-colors cursor-pointer inline-flex items-center gap-1 ${
                              isJustSaved
                                ? 'bg-emerald-600 border-emerald-600 text-white'
                                : 'bg-white border-slate-200 text-slate-700 hover:border-indigo-400 hover:text-indigo-600'
                            }`}
                          >
                            {isJustSaved ? (
                              <>
                                <Check className="w-3 h-3" />
                                已存
                              </>
                            ) : (
                              <>
                                <Save className="w-3 h-3" />
                                儲存
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={(e) => handleDuplicateTemplate(tpl, e)}
                            title="複製此範本"
                            className="p-1 rounded text-slate-500 hover:text-slate-800 hover:bg-white border border-transparent hover:border-slate-200 transition-colors cursor-pointer"
                          >
                            <Files className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={(e) => handleDeleteTemplate(tpl.id, e)}
                            title="刪除此範本"
                            className="px-1.5 py-0.5 text-[11px] font-medium text-rose-600 bg-white border border-rose-200 hover:bg-rose-600 hover:text-white rounded transition-colors cursor-pointer inline-flex items-center gap-0.5"
                          >
                            <Trash2 className="w-3 h-3" />
                            刪除
                          </button>
                        </div>
                      </div>

                      {/* Subject snippet */}
                      <p className="mt-1 text-xs text-slate-600 line-clamp-1 font-normal">
                        {tpl.subject || '（尚未填寫主旨固定文字）'}
                      </p>

                      {/* Clean Unboxed Metadata */}
                      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500 tabular-nums">
                        <span className="font-medium text-slate-600">
                          {tpl.category}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{varCount} 個變數框</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {new Date(tpl.updatedAt).toLocaleDateString('zh-TW', {
                            month: '2-digit',
                            day: '2-digit',
                          })}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Sidebar Footer: Import / Export JSON & Reset */}
            <div className="p-4 bg-slate-50/70 border-t border-slate-200 space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleExportJSON}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  匯出範本 JSON
                </button>
                <button
                  type="button"
                  onClick={handleImportClick}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5 text-slate-500" />
                  匯入範本 JSON
                </button>
              </div>

              <div className="flex items-center justify-between pt-1 text-xs text-slate-500">
                <button
                  type="button"
                  onClick={() => setShowHistoryModal(true)}
                  className="inline-flex items-center gap-1 hover:text-slate-800 transition-colors cursor-pointer"
                >
                  <History className="w-3.5 h-3.5" />
                  複製紀錄 ({copyHistory.length})
                </button>
                <button
                  type="button"
                  onClick={() => setShowResetModal(true)}
                  className="inline-flex items-center gap-1 hover:text-indigo-600 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  還原系統預設範本
                </button>
              </div>
            </div>
          </aside>

          {/* ====================================================================
              COLUMN 2 (Center, 5 cols): 步驟 1 — 編寫範本固定文字 ＆ 自訂變數框管理
             ==================================================================== */}
          <section
            className={`xl:col-span-5 space-y-5 ${
              mobileTab === 'design' ? 'block' : 'hidden xl:block'
            }`}
          >
            {!activeTemplate ? (
              <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-4">
                <h2 className="text-base font-bold text-slate-900">
                  目前沒有選取的郵件範本
                </h2>
                <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                  您可以點擊下方按鈕立即建立一個全新的空白範本，自由編寫固定文字並插入 <code className="font-mono text-indigo-600">[變數框]</code>。
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleQuickBlankTemplate}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors cursor-pointer shadow-xs"
                  >
                    <Plus className="w-4 h-4" />
                    新增空白範本
                  </button>
                  {lastDeletedBackup && (
                    <button
                      type="button"
                      onClick={handleUndoDelete}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors cursor-pointer"
                    >
                      <Undo2 className="w-4 h-4" />
                      復原剛刪除的範本
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                {/* Editor Top Header */}
                <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/60">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-indigo-600">
                        STEP 1
                      </span>
                      <span aria-hidden="true" className="text-slate-300">·</span>
                      <h2 className="text-base font-bold text-slate-900">
                        編寫範本固定文字 ＆ 插入變數框
                      </h2>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      自由輸入固定信件內容，並在需要挖空處點擊「插入變數框」或輸入 <code className="font-mono text-indigo-600">[變數名稱]</code>
                    </p>
                  </div>

                  {/* Direct Save, Save As New, and Delete buttons for the current template */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleSaveSingleTemplate(activeTemplate)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        savedFeedbackId === activeTemplate.id
                          ? 'bg-emerald-600 border-emerald-600 text-white'
                          : 'bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700'
                      }`}
                    >
                      {savedFeedbackId === activeTemplate.id ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          已儲存範本 ✓
                        </>
                      ) : (
                        <>
                          <Save className="w-3.5 h-3.5" />
                          儲存此範本
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleSaveAsNewTemplate}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      title="將目前編輯的內容另存為一組新的範本"
                    >
                      <FolderPlus className="w-3.5 h-3.5 text-slate-500" />
                      另存新範本
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteTemplate(activeTemplate.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-rose-600 bg-white border border-rose-200 rounded-lg hover:bg-rose-600 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      title="從範本庫刪除此範本"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      刪除此範本
                    </button>
                  </div>
                </div>

                <div className="p-5 space-y-4">
                  {/* Template Name & Category */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        範本名稱
                      </label>
                      <input
                        ref={templateNameInputRef}
                        type="text"
                        value={activeTemplate.name}
                        onChange={(e) =>
                          updateActiveTemplate({ name: e.target.value })
                        }
                        placeholder="請輸入此範本的名稱（例如：報價單寄送通知）..."
                        className="w-full px-3 py-2 text-sm font-medium bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-indigo-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        所屬分類
                      </label>
                      <select
                        value={activeTemplate.category}
                        onChange={(e) =>
                          updateActiveTemplate({
                            category: e.target.value as Exclude<
                              TemplateCategory,
                              '全部'
                            >,
                          })
                        }
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-indigo-600"
                      >
                        {TEMPLATE_CATEGORIES.filter((c) => c !== '全部').map(
                          (cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          )
                        )}
                      </select>
                    </div>
                  </div>

                  {/* ====================================================
                      VARIABLE BOX INSERTION & MANAGEMENT STUDIO
                      Supports both ADDING and DELETING custom variable boxes!
                     ==================================================== */}
                  <div className="p-4 bg-indigo-50/50 border border-indigo-200/80 rounded-xl space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <Brackets className="w-4 h-4 text-indigo-600" />
                        <span className="text-xs font-bold text-slate-900">
                          自訂變數框管理（可自由新增、點擊插入或刪除標籤）
                        </span>
                      </div>

                      {/* Target Selector: Insert into Subject vs Body */}
                      <div className="flex items-center gap-1 bg-white p-0.5 rounded-lg border border-slate-200 text-xs">
                        <span className="text-[11px] text-slate-500 pl-2 pr-1">
                          插入位置：
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setLastFocusedField('subject');
                            subjectInputRef.current?.focus();
                          }}
                          className={`px-2 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                            lastFocusedField === 'subject'
                              ? 'bg-indigo-600 text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          郵件主旨
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setLastFocusedField('body');
                            bodyTextareaRef.current?.focus();
                          }}
                          className={`px-2 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                            lastFocusedField === 'body'
                              ? 'bg-indigo-600 text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          郵件內文
                        </button>
                      </div>
                    </div>

                    {/* Custom Variable Box Creator Input */}
                    <form
                      onSubmit={handleAddAndInsertCustomVariable}
                      className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
                    >
                      <div className="relative flex-1">
                        <input
                          type="text"
                          value={customVarInput}
                          onChange={(e) => setCustomVarInput(e.target.value)}
                          placeholder="輸入自訂變數名稱（例如：取件編號、折扣碼、客戶統編）..."
                          className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-600"
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={handleAddChipOnly}
                          className="inline-flex items-center justify-center gap-1 px-3 py-2 text-xs font-semibold text-indigo-700 bg-white border border-indigo-300 hover:bg-indigo-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          新增至標籤庫
                        </button>
                        <button
                          type="submit"
                          className="inline-flex items-center justify-center gap-1 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          新增並插入至{lastFocusedField === 'subject' ? '主旨' : '內文'}
                        </button>
                      </div>
                    </form>

                    {/* Highlighted Text to Variable Box Action */}
                    {selectedTextInfo && (
                      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-amber-50 border border-amber-300 rounded-lg">
                        <span className="text-xs text-amber-900">
                          已反白選取文字「<strong>{selectedTextInfo.text}</strong>」
                        </span>
                        <button
                          type="button"
                          onClick={handleConvertSelectionToVariable}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <MousePointerClick className="w-3.5 h-3.5" />
                          將反白文字轉為 [{selectedTextInfo.text}] 變數框
                        </button>
                      </div>
                    )}

                    {/* All Variable Box Chips — Every single chip can be clicked to insert OR deleted via × */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>點擊標籤插入至游標處，點擊右側「×」即可刪除該變數框標籤：</span>
                        <button
                          type="button"
                          onClick={() => setVariableChips(DEFAULT_VARIABLE_CHIPS)}
                          className="text-slate-500 hover:text-indigo-600 underline cursor-pointer"
                        >
                          重置預設變數標籤
                        </button>
                      </div>

                      {variableChips.length === 0 ? (
                        <div className="py-2.5 px-3 text-xs text-slate-500 bg-white/80 rounded-lg border border-dashed border-slate-200 text-center">
                          目前沒有常用變數標籤，請由上方輸入框新增自訂變數框。
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {variableChips.map((chip) => (
                            <div
                              key={chip}
                              className="inline-flex items-center bg-white border border-slate-200 rounded-md overflow-hidden hover:border-indigo-400 transition-colors"
                            >
                              <button
                                type="button"
                                onClick={() => insertVariableAtCursor(chip)}
                                className="px-2 py-1 text-xs font-mono text-slate-700 hover:text-indigo-600 hover:bg-indigo-50/50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                title={`點擊在游標位置插入 [${chip}]`}
                              >
                                + [{chip}]
                              </button>
                              <button
                                type="button"
                                onClick={(e) => handleDeleteVariableChip(chip, e)}
                                className="px-1.5 py-1 text-xs text-slate-400 hover:text-rose-600 hover:bg-rose-50 border-l border-slate-100 transition-colors cursor-pointer"
                                title={`刪除 [${chip}] 標籤`}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ====================================================
                      SUBJECT TEMPLATE EDITOR (主旨固定文字與變數框)
                     ==================================================== */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label
                        htmlFor="tpl-subject-input"
                        className="text-xs font-bold text-slate-800 flex items-center gap-1.5"
                      >
                        <span>郵件主旨 (Subject)</span>
                        {lastFocusedField === 'subject' && (
                          <span className="text-[11px] font-medium text-indigo-600">
                            · 目前游標所在處
                          </span>
                        )}
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setLastFocusedField('subject');
                          insertVariableAtCursor(
                            customVarInput.trim() || '主旨變數',
                            'subject'
                          );
                        }}
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-800 cursor-pointer"
                      >
                        + 在主旨插入變數框
                      </button>
                    </div>
                    <input
                      id="tpl-subject-input"
                      ref={subjectInputRef}
                      type="text"
                      value={activeTemplate.subject}
                      onFocus={() => handleRecordSelection('subject')}
                      onClick={() => handleRecordSelection('subject')}
                      onKeyUp={() => handleRecordSelection('subject')}
                      onSelect={() => handleRecordSelection('subject')}
                      onChange={(e) => {
                        updateActiveTemplate({ subject: e.target.value });
                        handleRecordSelection('subject');
                      }}
                      placeholder="請在此編寫主旨固定文字，例如：【專案通知】[公司名稱] — [專案名稱] 進度確認"
                      className={`w-full px-3.5 py-2.5 text-sm font-medium bg-white border rounded-lg text-slate-900 focus:outline-none transition-colors ${
                        lastFocusedField === 'subject'
                          ? 'border-indigo-600 ring-2 ring-indigo-600/10'
                          : 'border-slate-200 focus:border-indigo-600'
                      }`}
                    />
                  </div>

                  {/* ====================================================
                      BODY TEMPLATE EDITOR (內文固定文字與變數框)
                     ==================================================== */}
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                      <label
                        htmlFor="tpl-body-textarea"
                        className="text-xs font-bold text-slate-800 flex items-center gap-1.5"
                      >
                        <span>郵件內文 (Body 固定文字與變數框)</span>
                        {lastFocusedField === 'body' && (
                          <span className="text-[11px] font-medium text-indigo-600">
                            · 目前游標所在處
                          </span>
                        )}
                      </label>

                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-[11px] text-slate-400">
                          插入固定段落：
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            insertFixedSnippet('[收件人姓名] 您好：\n\n感謝您的來信與協助。')
                          }
                          className="text-[11px] font-medium text-slate-600 hover:text-indigo-600 underline underline-offset-2 cursor-pointer"
                        >
                          + 開頭問候語
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            insertFixedSnippet(
                              '若有任何問題，歡迎隨時與我聯繫。\n\n順頌 商祺\n\n[寄件人姓名]\n[寄件人職稱]｜[聯絡電話]'
                            )
                          }
                          className="text-[11px] font-medium text-slate-600 hover:text-indigo-600 underline underline-offset-2 cursor-pointer"
                        >
                          + 結尾敬語與簽名檔
                        </button>
                      </div>
                    </div>

                    <textarea
                      id="tpl-body-textarea"
                      ref={bodyTextareaRef}
                      rows={14}
                      value={activeTemplate.body}
                      onFocus={() => handleRecordSelection('body')}
                      onClick={() => handleRecordSelection('body')}
                      onKeyUp={() => handleRecordSelection('body')}
                      onSelect={() => handleRecordSelection('body')}
                      onChange={(e) => {
                        updateActiveTemplate({ body: e.target.value });
                        handleRecordSelection('body');
                      }}
                      placeholder="請在此自由編寫郵件的固定文字內容...&#10;&#10;需要挖空填寫的地方，請點擊上方「+ 插入變數框」按鈕，或直接輸入 [變數名稱]。"
                      className={`w-full px-3.5 py-3 text-sm leading-relaxed bg-white border rounded-lg text-slate-900 focus:outline-none font-sans transition-colors ${
                        lastFocusedField === 'body'
                          ? 'border-indigo-600 ring-2 ring-indigo-600/10'
                          : 'border-slate-200 focus:border-indigo-600'
                      }`}
                    />

                    {/* Detected Variable Summary & Bottom Save Bar */}
                    <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <span>
                        目前已偵測到{' '}
                        <strong className="text-indigo-600 tabular-nums">
                          {detectedVariables.length}
                        </strong>{' '}
                        個變數框 · 總長 {activeTemplate.body.length} 字
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleSaveSingleTemplate(activeTemplate)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors cursor-pointer"
                        >
                          <Save className="w-3.5 h-3.5" />
                          儲存此範本
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* ====================================================================
              COLUMN 3 (Right, 4 cols): 步驟 2 — 填寫變數框內容 ＆ 即時預覽與一鍵複製
             ==================================================================== */}
          <aside
            className={`xl:col-span-4 space-y-5 ${
              mobileTab === 'fillAndPreview' ? 'block' : 'hidden xl:block'
            }`}
          >
            {/* 3A. STEP 2: 變數框填空區 */}
            {activeTemplate && (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-slate-50/60">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-indigo-600">
                        STEP 2
                      </span>
                      <span aria-hidden="true" className="text-slate-300">·</span>
                      <h2 className="text-sm font-bold text-slate-900">
                        填寫變數框內容
                      </h2>
                      <span className="text-xs text-slate-500 tabular-nums">
                        ({filledCount}/{detectedVariables.length})
                      </span>
                    </div>
                  </div>

                  {/* Quick Value Actions */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={handleFillSampleValues}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      title="載入預設或範例數值"
                    >
                      <Sparkles className="w-3 h-3" />
                      帶入預設值
                    </button>
                    <button
                      type="button"
                      onClick={handleFillTodayDate}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      title="填入今日日期"
                    >
                      <Calendar className="w-3 h-3" />
                      今日日期
                    </button>
                    <button
                      type="button"
                      onClick={handleClearVariables}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-600 hover:text-rose-600 bg-slate-100 hover:bg-rose-50 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      title="清空所有已填寫的變數"
                    >
                      <Eraser className="w-3 h-3" />
                      清空
                    </button>
                  </div>
                </div>

                <div className="p-4 max-h-[360px] overflow-y-auto">
                  {detectedVariables.length === 0 ? (
                    <div className="py-6 px-4 text-center bg-slate-50 rounded-lg border border-dashed border-slate-200 space-y-1.5">
                      <p className="text-xs font-semibold text-slate-700">
                        此範本目前沒有任何 [變數框]
                      </p>
                      <p className="text-xs text-slate-500">
                        在左側「STEP 1」編寫固定文字時，點擊「+ 插入變數框」，此處就會自動生成對應的輸入欄。
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3">
                      {detectedVariables.map((varName, index) => {
                        const val = currentValues[varName] ?? '';
                        const isFilled = val.trim() !== '';
                        const locations = getVariableLocations(
                          varName,
                          activeTemplate.subject,
                          activeTemplate.body
                        );
                        const isMultiline =
                          customMultilineVars[varName] ??
                          isLikelyMultilineVariable(varName, val);

                        return (
                          <div key={varName}>
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <label
                                htmlFor={`var-input-${index}`}
                                className="text-xs font-semibold text-slate-800 flex items-center gap-1.5"
                              >
                                <span className="font-mono text-indigo-600 tabular-nums">
                                  [{varName}]
                                </span>
                              </label>

                              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                                <span>
                                  {locations.inSubject && locations.inBody
                                    ? '主旨 · 內文'
                                    : locations.inSubject
                                    ? '主旨'
                                    : '內文'}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCustomMultilineVars((prev) => ({
                                      ...prev,
                                      [varName]: !isMultiline,
                                    }))
                                  }
                                  className="text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                                  title={
                                    isMultiline
                                      ? '切換為單行輸入框'
                                      : '切換為多行文字框'
                                  }
                                >
                                  {isMultiline ? (
                                    <Type className="w-3.5 h-3.5" />
                                  ) : (
                                    <AlignLeft className="w-3.5 h-3.5" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveVariableFromTemplate(varName)}
                                  className="text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                                  title={`從範本中刪除 [${varName}] 變數框`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {isMultiline ? (
                              <textarea
                                id={`var-input-${index}`}
                                ref={(el) => {
                                  variableInputRefs.current[varName] = el;
                                }}
                                rows={2}
                                value={val}
                                onFocus={() => setFocusedVariable(varName)}
                                onBlur={() => setFocusedVariable(null)}
                                onChange={(e) =>
                                  handleVariableChange(varName, e.target.value)
                                }
                                placeholder={`填入 [${varName}] 的內容...`}
                                className={`w-full px-3 py-1.5 text-sm rounded-lg border transition-colors focus:outline-none ${
                                  isFilled
                                    ? 'bg-white border-slate-300 text-slate-900 focus:border-indigo-600'
                                    : 'bg-amber-50/30 border-amber-300/80 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-indigo-600'
                                }`}
                              />
                            ) : (
                              <input
                                id={`var-input-${index}`}
                                ref={(el) => {
                                  variableInputRefs.current[varName] = el;
                                }}
                                type="text"
                                value={val}
                                onFocus={() => setFocusedVariable(varName)}
                                onBlur={() => setFocusedVariable(null)}
                                onChange={(e) =>
                                  handleVariableChange(varName, e.target.value)
                                }
                                placeholder={`填入 [${varName}] 的內容...`}
                                className={`w-full px-3 py-1.5 text-sm rounded-lg border transition-colors focus:outline-none ${
                                  isFilled
                                    ? 'bg-white border-slate-300 text-slate-900 focus:border-indigo-600'
                                    : 'bg-amber-50/30 border-amber-300/80 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-indigo-600'
                                }`}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {detectedVariables.length > 0 && (
                    <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                      <span>點擊下方預覽中的變數也可快速跳轉至此</span>
                      <button
                        type="button"
                        onClick={handleSaveCurrentAsTemplateDefaults}
                        className="text-indigo-600 hover:text-indigo-800 font-medium cursor-pointer"
                      >
                        設為此範本預設值
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 3B. STEP 3: 即時郵件預覽與一鍵複製 */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
              {/* Preview Header */}
              <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-slate-900 text-white">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-indigo-400">
                      STEP 3
                    </span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <h2 className="text-sm font-semibold tracking-wide">
                      即時預覽 ＆ 一鍵複製
                    </h2>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setHighlightVariables((prev) => !prev)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    highlightVariables
                      ? 'bg-indigo-500 text-white'
                      : 'bg-slate-800 text-slate-300 hover:text-white'
                  }`}
                >
                  {highlightVariables ? '標示變數框：開' : '標示變數框：關'}
                </button>
              </div>

              {/* Independent One-Click Copy Buttons */}
              <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={!activeTemplate}
                  onClick={() =>
                    handleCopyText(renderedSubject, 'subject', '郵件主旨')
                  }
                  className={`flex items-center justify-center gap-1.5 py-2.5 px-4 text-xs font-semibold rounded-lg border transition-all whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 ${
                    copiedKey === 'subject'
                      ? 'bg-emerald-600 border-emerald-600 text-white'
                      : 'bg-white border-slate-300 text-slate-800 hover:bg-slate-100 hover:border-slate-400'
                  }`}
                >
                  {copiedKey === 'subject' ? (
                    <>
                      <Check className="w-4 h-4" />
                      已複製主旨 ✓
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-indigo-600" />
                      複製主旨
                    </>
                  )}
                </button>

                <button
                  type="button"
                  disabled={!activeTemplate}
                  onClick={() =>
                    handleCopyText(renderedBody, 'body', '郵件內文')
                  }
                  className={`flex items-center justify-center gap-1.5 py-2.5 px-4 text-xs font-semibold rounded-lg transition-all whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 ${
                    copiedKey === 'body'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700'
                  }`}
                >
                  {copiedKey === 'body' ? (
                    <>
                      <Check className="w-4 h-4" />
                      已複製內文 ✓
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      複製內文
                    </>
                  )}
                </button>
              </div>

              {/* Live Subject Preview Box (Removed the duplicate copy button on the right) */}
              <div className="px-5 py-3 bg-slate-50/60 border-b border-slate-200">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[11px] font-semibold text-slate-400">
                    主旨預覽 (SUBJECT)
                  </span>
                </div>

                <div className="text-sm font-semibold text-slate-900 leading-snug break-words min-h-[1.5rem]">
                  {!activeTemplate?.subject ? (
                    <span className="text-slate-400 font-normal text-xs">
                      （尚未編寫主旨）
                    </span>
                  ) : highlightVariables ? (
                    subjectSegments.map((seg, i) =>
                      seg.type === 'text' ? (
                        <React.Fragment key={i}>{seg.raw}</React.Fragment>
                      ) : (
                        <span
                          key={i}
                          onClick={() =>
                            seg.varName && handlePreviewVariableClick(seg.varName)
                          }
                          title={`點擊填寫 [${seg.varName}]`}
                          className={`inline rounded px-1 py-0.5 transition-colors cursor-pointer ${
                            focusedVariable === seg.varName
                              ? 'bg-indigo-600 text-white'
                              : seg.isFilled
                              ? 'bg-indigo-50 text-indigo-900 underline decoration-indigo-300 underline-offset-4'
                              : 'bg-amber-100/90 text-amber-900 font-mono text-xs'
                          }`}
                        >
                          {seg.isFilled ? seg.value : `[${seg.varName}]`}
                        </span>
                      )
                    )
                  ) : (
                    renderedSubject
                  )}
                </div>
              </div>

              {/* Live Body Preview Canvas (Removed the "未填寫時保留 [變數框]" checkbox) */}
              <div className="p-5 flex-1 max-h-[380px] overflow-y-auto">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-[11px] font-semibold text-slate-400">
                    內文預覽 (BODY)
                  </span>
                </div>

                <div className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap break-words font-sans min-h-[120px]">
                  {!activeTemplate?.body ? (
                    <span className="text-slate-400 text-xs">
                      （請於中央編輯區編寫固定文字並插入 [變數框]，此處將即時呈現完整信件內容）
                    </span>
                  ) : highlightVariables ? (
                    bodySegments.map((seg, i) =>
                      seg.type === 'text' ? (
                        <React.Fragment key={i}>{seg.raw}</React.Fragment>
                      ) : (
                        <span
                          key={i}
                          onClick={() =>
                            seg.varName && handlePreviewVariableClick(seg.varName)
                          }
                          title={`點擊填寫 [${seg.varName}]`}
                          className={`rounded px-1 py-0.5 transition-colors cursor-pointer ${
                            focusedVariable === seg.varName
                              ? 'bg-indigo-600 text-white'
                              : seg.isFilled
                              ? 'bg-indigo-50/90 text-indigo-950 font-medium underline decoration-indigo-300 underline-offset-4'
                              : 'bg-amber-100/90 text-amber-900 font-mono text-xs'
                          }`}
                        >
                          {seg.isFilled ? seg.value : `[${seg.varName}]`}
                        </span>
                      )
                    )
                  ) : (
                    renderedBody
                  )}
                </div>
              </div>

              {/* Preview Footer: Copy Full Email & Launch Mail Client */}
              <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={!activeTemplate}
                  onClick={() =>
                    handleCopyText(
                      `主旨：${renderedSubject}\n\n${renderedBody}`,
                      'full',
                      '完整郵件（含主旨與內文）'
                    )
                  }
                  className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40"
                >
                  {copiedKey === 'full' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      已複製完整郵件
                    </>
                  ) : (
                    <>
                      <FileText className="w-3.5 h-3.5 text-slate-500" />
                      複製主旨 + 內文
                    </>
                  )}
                </button>

                <a
                  href={mailtoHref}
                  className="inline-flex items-center justify-center gap-1.5 py-2 px-3.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
                  title="使用系統預設郵件軟體開啟草稿"
                >
                  <Mail className="w-3.5 h-3.5 text-slate-500" />
                  於郵件軟體開啟
                </a>
              </div>
            </div>
          </aside>
        </div>
      </main>

      {/* Quiet Footer */}
      <footer className="mt-auto border-t border-slate-200 bg-white py-4 px-6">
        <div className="max-w-[1600px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            MailForge 高級郵件草稿快速生成工具 · 資料自動安全儲存於本機瀏覽器 (localStorage)
          </span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={handleExportJSON}
              className="hover:text-slate-900 transition-colors cursor-pointer"
            >
              下載 JSON 備份
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={handleImportClick}
              className="hover:text-slate-900 transition-colors cursor-pointer"
            >
              還原 JSON 備份
            </button>
          </div>
        </div>
      </footer>

      {/* ============================================================
          MODAL 0: CREATE NEW CUSTOM TEMPLATE DIALOG
         ============================================================ */}
      {showNewTemplateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateTemplateConfirm}
            className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 shadow-xl space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  新增自訂郵件範本
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  建立後即可在中央編輯區自由編寫固定文字並插入 <code className="font-mono text-indigo-600">[變數框]</code>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewTemplateModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  範本名稱
                </label>
                <input
                  type="text"
                  autoFocus
                  value={newTplName}
                  onChange={(e) => setNewTplName(e.target.value)}
                  placeholder="例如：每週工作進度回報、客戶報價單寄送..."
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  範本分類
                </label>
                <select
                  value={newTplCategory}
                  onChange={(e) =>
                    setNewTplCategory(
                      e.target.value as Exclude<TemplateCategory, '全部'>
                    )
                  }
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-600"
                >
                  {TEMPLATE_CATEGORIES.filter((c) => c !== '全部').map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  初始內容模式
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setNewTplMode('blank')}
                    className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                      newTplMode === 'blank'
                        ? 'border-indigo-600 bg-indigo-50/60 text-indigo-950'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="text-xs font-bold">完全空白範本</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      從零開始自行編寫所有固定文字與變數框
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNewTplMode('starter')}
                    className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                      newTplMode === 'starter'
                        ? 'border-indigo-600 bg-indigo-50/60 text-indigo-950'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="text-xs font-bold">含問候與結尾結構</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      預先帶入稱謂、結尾敬語與常用變數框
                    </div>
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewTemplateModal(false)}
                className="px-3.5 py-2 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors cursor-pointer"
              >
                立即建立並儲存
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ============================================================
          MODAL 2: IMPORT JSON MERGE VS REPLACE CONFIRMATION
         ============================================================ */}
      {importPendingData && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  確認匯入郵件範本備份
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  備份檔案共包含{' '}
                  <strong className="text-slate-900 tabular-nums">
                    {importPendingData.templates.length}
                  </strong>{' '}
                  組有效郵件範本。請選擇匯入方式：
                </p>
              </div>
              <button
                type="button"
                onClick={() => setImportPendingData(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 max-h-40 overflow-y-auto divide-y divide-slate-200/60 text-xs">
              {importPendingData.templates.map((t) => (
                <div key={t.id} className="py-1.5 flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-800 truncate">
                    {t.name}
                  </span>
                  <span className="text-slate-500 shrink-0">{t.category}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setImportPendingData(null)}
                className="w-full sm:w-auto px-3.5 py-2 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => applyImportData('replace')}
                className="w-full sm:w-auto px-3.5 py-2 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors"
              >
                覆蓋現有全部範本
              </button>
              <button
                type="button"
                onClick={() => applyImportData('merge')}
                className="w-full sm:w-auto px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
              >
                合併至現有範本庫
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          MODAL 3: RESET TO DEFAULTS CONFIRMATION
         ============================================================ */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-900">
              確定要還原為系統預設範本嗎？
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              這將會載入系統內建的 3 組商務郵件範本與預設範例資料。若您有自訂的重要範本，建議先點擊「匯出範本 JSON」進行備份。
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowResetModal(false)}
                className="px-3.5 py-2 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmResetDefaults}
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
              >
                確認還原預設範本
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          MODAL 4: RECENT COPY HISTORY
         ============================================================ */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full p-6 shadow-xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  近期複製紀錄
                </h3>
                <p className="text-xs text-slate-500">
                  保留最近 25 筆複製過的郵件草稿，方便隨時回溯或再次複製
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowHistoryModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
              {copyHistory.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  尚無複製紀錄。當您點擊「複製主旨」或「複製內文」時，系統會自動記錄於此。
                </div>
              ) : (
                copyHistory.map((item) => (
                  <div key={item.id} className="p-3.5 space-y-1.5 hover:bg-slate-50">
                    <div className="flex items-center justify-between text-xs text-slate-500 tabular-nums">
                      <span className="font-semibold text-slate-800">
                        {item.templateName}
                      </span>
                      <span>
                        {new Date(item.copiedAt).toLocaleString('zh-TW', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="text-xs font-medium text-slate-900">
                      主旨：{item.subject}
                    </p>
                    <p className="text-xs text-slate-600 line-clamp-2 whitespace-pre-wrap">
                      {item.body}
                    </p>
                    <div className="pt-1 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          handleCopyText(item.subject, 'subject', '歷史紀錄主旨')
                        }
                        className="text-[11px] font-medium text-indigo-600 hover:underline cursor-pointer"
                      >
                        複製此主旨
                      </button>
                      <span className="text-slate-300">·</span>
                      <button
                        type="button"
                        onClick={() =>
                          handleCopyText(item.body, 'body', '歷史紀錄內文')
                        }
                        className="text-[11px] font-medium text-indigo-600 hover:underline cursor-pointer"
                      >
                        複製此內文
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-between pt-1">
              {copyHistory.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setCopyHistory([])}
                  className="text-xs text-rose-600 hover:underline cursor-pointer"
                >
                  清空所有紀錄
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => setShowHistoryModal(false)}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800"
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          TOAST NOTIFICATIONS (Non-blocking feedback)
         ============================================================ */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-start gap-2.5 p-3.5 rounded-xl bg-slate-900 text-white shadow-lg border border-slate-800 transition-all"
          >
            {t.type === 'success' && (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            )}
            {t.type === 'warning' && (
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            )}
            {t.type === 'error' && (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold">{t.title}</p>
              {t.detail && (
                <p className="text-[11px] text-slate-300 mt-0.5 leading-snug">
                  {t.detail}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
