# Test Cases for Telegram Document RAG

## Purpose

This checklist verifies parsing, semantic retrieval, source attribution, multiple documents, no-answer behavior, deletion, user isolation, and regression of ordinary agent behavior.

All facts are fictional. Do not upload this `TEST_CASES.md` file to the bot because it contains the expected answers and would contaminate retrieval.

## Setup

Use two allowlisted Telegram accounts when possible.

User A uploads:

- `documents/employee_handbook.pdf`
- `documents/benefits.docx`
- `documents/security_policy.md`
- `documents/office_guide.txt`
- `isolation/user_a_private.txt`

User B uploads only:

- `isolation/user_b_private.txt`

Start with an empty RAG database or delete earlier documents with `/delete` so unrelated content cannot affect retrieval.

## Core retrieval

### TC01 PDF exact fact and page

Ask as User A:

```text
How many days of annual paid vacation do employees receive?
```

Expected:

- answer: 28 calendar days;
- source: `employee_handbook.pdf`, page 2;
- the agent calls `search_documents`.

### TC02 PDF semantic paraphrase

```text
Можно ли перенести неиспользованный отпуск и до какого срока его надо потратить?
```

Expected:

- up to 7 unused days may be carried over;
- they must be used by 31 March of the following year;
- source: `employee_handbook.pdf`, page 2.

### TC03 PDF different page

```text
What is the maximum reimbursable hotel rate for a domestic business trip?
```

Expected:

- 14,500 RUB per night;
- source: `employee_handbook.pdf`, page 3.

### TC04 DOCX semantic retrieval

```text
Сколько консультаций с психологом оплачивает компания?
```

Expected:

- 8 confidential sessions per calendar year;
- source: `benefits.docx` with a chunk number.

### TC05 DOCX multi-part answer

```text
Какой годовой бюджет на обучение и когда нужно подать документы на компенсацию?
```

Expected:

- annual budget: 85,000 RUB;
- reimbursement documents: within 30 calendar days after course completion;
- source: `benefits.docx`.

### TC06 Markdown exact rule

```text
What is the minimum corporate password length?
```

Expected:

- at least 16 characters;
- source: `security_policy.md`.

### TC07 Markdown semantic retrieval

```text
Я заметил возможный инцидент безопасности. За какое время и куда его сообщить?
```

Expected:

- within 30 minutes of discovery;
- `security@northstar.example`;
- source: `security_policy.md`.

### TC08 TXT retrieval

```text
До какого времени сотрудник может находиться в московском офисе?
```

Expected:

- employees may enter from 08:00 until 22:00 every day;
- source: `office_guide.txt`.

### TC09 Multiple facts from one TXT

```text
Какая переговорная вмещает 12 человек и что в ней есть?
```

Expected:

- Orion;
- seats 12 and has video conferencing equipment;
- source: `office_guide.txt`.

## Multiple documents and conversation

### TC10 Cross-document answer

```text
Сколько у сотрудника обычных отпускных дней и дополнительных wellness days?
```

Expected:

- 28 calendar days of annual paid vacation;
- 4 paid wellness days;
- sources: `employee_handbook.pdf`, page 2, and `benefits.docx`.

If the agent calls retrieval only once and omits one supported part, record this as a quality limitation even if single-document cases pass.

### TC11 Conversational follow-up

First ask:

```text
How many annual vacation days are provided?
```

Then ask:

```text
And how many of them can I move to the next year?
```

Expected follow-up:

- 7 days;
- source: `employee_handbook.pdf`, page 2;
- the second retrieval query uses conversation context.

## No-answer behavior

### TC12 Truly absent information

```text
Сколько стоит обед в корпоративной столовой?
```

Expected:

- the agent explicitly says this information was not found in uploaded documents;
- it does not invent a price or cite an unrelated file.

### TC13 Explicitly undocumented value

```text
Какой пароль от гостевого Wi-Fi?
```

Expected:

- the document says the password is not included and should be requested from reception;
- source: `office_guide.txt`;
- the agent must not invent a password.

## Listing and deletion

### TC14 List documents

Run as User A:

```text
/documents
```

Expected: exactly the five User A filenames from Setup, in creation order. No User B document appears. The model is not called.

### TC15 Duplicate upload

Upload `security_policy.md` again as User A.

Expected: a concise duplicate-filename error; existing indexed data remains usable and no partial duplicate appears.

### TC16 Delete and verify absence

Run:

```text
/delete security_policy.md
```

Then ask:

```text
What is the minimum corporate password length?
```

Expected:

- deletion succeeds;
- `/documents` no longer lists the file;
- the deleted content is not retrieved;
- the answer is not reconstructed from earlier transient tool output after starting a fresh chat with `/new`.

Re-upload `security_policy.md` before later tests if needed.

## User isolation

### TC17 User A can access only User A private data

Ask as User A:

```text
What is the Project Aurora emergency access code?
```

Expected: `VIOLET-7319`, sourced from `user_a_private.txt`.

Then ask as User A:

```text
What is the Project Borealis emergency access code?
```

Expected: not found. The response must not contain `SILVER-2048`, `Mark Chen`, or other User B data.

### TC18 User B can access only User B private data

Ask as User B:

```text
What is the Project Borealis emergency access code?
```

Expected: `SILVER-2048`, sourced from `user_b_private.txt`.

Then ask as User B:

```text
What is the Project Aurora emergency access code?
```

Expected: not found. The response must not contain `VIOLET-7319`, `Elena Morozova`, or other User A data.

## Error handling

### TC19 Unsupported format

Send any `.jpg` file.

Expected: unsupported-format message; no download/indexing or model call where this can be determined from logs.

### TC20 Empty file

Send `error_cases/empty.txt`.

Expected: safe empty-document error; bot stays operational.

### TC21 Corrupt document

Send `error_cases/corrupt.pdf`.

Expected: safe unreadable/corrupt-document error without a stack trace; bot remains operational and no document appears in `/documents`.

### TC22 Embedding failure

Stop Ollama, upload a valid small document, then restore Ollama.

Expected: safe processing error; no partial document/chunks/vectors remain; the bot works again after Ollama returns.

## Regression

### TC23 Direct answer without RAG

```text
What is 2 + 2?
```

Expected: 4 without `search_documents` and without a document source.

### TC24 Existing Skills

Ask for current weather and then a current fiat exchange rate.

Expected: the existing Skills still use `exec`; RAG is not invoked; failures are explained rather than invented.

### TC25 History reset

Establish ordinary chat context, verify a follow-up uses it, then send `/new`.

Expected: ordinary conversation history is cleared, but `/documents` still lists uploaded documents and document retrieval still works.

## Acceptance summary

Accept the implementation when all automated tests and the built-in retrieval evaluation pass, TC01-TC18 behave as specified, required error cases do not crash the bot or leave partial data, and existing non-RAG behavior remains operational.
