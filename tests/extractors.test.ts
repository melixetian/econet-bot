import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { extractDocument } from "../src/rag/extractors.js";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
function directory(): string { const path = mkdtempSync(join(tmpdir(), "rag-extract-")); directories.push(path); return path; }
async function docx(text: string): Promise<Buffer> { const zip = new JSZip(); zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'); zip.folder("_rels")!.file(".rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'); zip.folder("word")!.file("document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`); return zip.generateAsync({ type: "nodebuffer" }); }
function pdf(text: string): Buffer { const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`; const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]; let body = "%PDF-1.4\n"; const offsets = [0]; objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; }); const xref = Buffer.byteLength(body); body += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`; return Buffer.from(body); }

describe("document extraction", () => {
  it("extracts and normalizes TXT and Markdown", async () => { const root = directory(); const txt = join(root, "a.txt"); const md = join(root, "a.md"); writeFileSync(txt, "one\r\n\r\n\r\ntwo\0"); writeFileSync(md, "# Heading\n\nBody"); await expect(extractDocument(txt, "txt", 100)).resolves.toEqual([{ text: "one\n\ntwo" }]); await expect(extractDocument(md, "md", 100)).resolves.toEqual([{ text: "# Heading\n\nBody" }]); });
  it("extracts DOCX fixtures", async () => { const root = directory(); const path = join(root, "a.docx"); writeFileSync(path, await docx("DOCX marker")); expect((await extractDocument(path, "docx", 1_000))[0]?.text).toContain("DOCX marker"); });
  it("extracts page-aware PDF fixtures", async () => {
    const root = directory(); const path = join(root, "a.pdf"); writeFileSync(path, pdf("PDF marker"));
    expect(await extractDocument(path, "pdf", 1_000)).toEqual([{ text: "PDF marker", pageNumber: 1 }]);
    // pdfjs-dist is intentionally loaded only for PDFs. Its first ESM/worker
    // load can take tens of seconds when all Vitest files transform in parallel.
  }, 60_000);
  it("rejects corrupt, empty, and oversized extracted content", async () => { const root = directory(); const corrupt = join(root, "bad.pdf"); const empty = join(root, "empty.txt"); const large = join(root, "large.txt"); writeFileSync(corrupt, "not pdf"); writeFileSync(empty, " \n\0"); writeFileSync(large, "abcdef"); await expect(extractDocument(corrupt, "pdf", 100)).rejects.toMatchObject({ code: "document_parse_failed" }); await expect(extractDocument(empty, "txt", 100)).rejects.toMatchObject({ code: "document_empty" }); await expect(extractDocument(large, "txt", 5)).rejects.toMatchObject({ code: "extracted_text_too_large" }); });
});
