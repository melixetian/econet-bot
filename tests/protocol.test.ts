import { describe, expect, it } from "vitest";
import { JsonLineDecoder, parseInferenceRequest, parseInferenceResponse } from "../src/inference/protocol.js";

describe("protocol", () => {
  it("strictly parses every request operation", () => {
    expect(parseInferenceRequest('{"id":"1","type":"chat","conversationId":"c","userId":"u","prompt":"hi"}')?.type).toBe("chat");
    expect(parseInferenceRequest('{"id":"2","type":"reset","conversationId":"c"}')?.type).toBe("reset");
    expect(parseInferenceRequest('{"id":"3","type":"index_document","userId":"u","filename":"a.pdf","fileType":"pdf","tempPath":"/tmp/x"}')?.type).toBe("index_document");
    expect(parseInferenceRequest('{"id":"4","type":"list_documents","userId":"u"}')?.type).toBe("list_documents");
    expect(parseInferenceRequest('{"id":"5","type":"delete_document","userId":"u","filename":"a.pdf"}')?.type).toBe("delete_document");
  });
  it("rejects extra fields, unsafe names, mismatched types, and model-supplied ownership", () => {
    expect(parseInferenceRequest('{"id":"1","type":"chat","conversationId":"c","userId":"u","prompt":"hi","extra":1}')).toBeNull();
    expect(parseInferenceRequest('{"id":"1","type":"index_document","userId":"u","filename":"../a.pdf","fileType":"pdf","tempPath":"/tmp/x"}')).toBeNull();
    expect(parseInferenceRequest('{"id":"1","type":"index_document","userId":"u","filename":"a.pdf","fileType":"txt","tempPath":"/tmp/x"}')).toBeNull();
  });
  it("parses typed responses and decodes chunks", () => { expect(parseInferenceResponse('{"id":"1","ok":true,"type":"reset"}')).toEqual({ id: "1", ok: true, type: "reset" }); expect(parseInferenceResponse('{"id":"1","ok":false,"error":"safe","code":"x"}')?.ok).toBe(false); const decoder = new JsonLineDecoder(); expect(decoder.push("a")).toEqual([]); expect(decoder.push("\n")).toEqual(["a"]); });
});
