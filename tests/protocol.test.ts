import { describe, expect, it } from "vitest";
import {
  JsonLineDecoder,
  parseInferenceRequest,
  parseInferenceResponse,
} from "../src/inference/protocol.js";

describe("inference protocol", () => {
  it("parses valid requests and responses", () => {
    expect(parseInferenceRequest('{"id":"1","prompt":"hello"}')).toEqual({
      id: "1",
      prompt: "hello",
    });
    expect(
      parseInferenceResponse('{"id":"1","ok":true,"text":"answer"}'),
    ).toEqual({ id: "1", ok: true, text: "answer" });
    expect(
      parseInferenceResponse('{"id":"2","ok":false,"error":"failed"}'),
    ).toEqual({ id: "2", ok: false, error: "failed" });
  });

  it("rejects malformed messages", () => {
    expect(parseInferenceRequest("not json")).toBeNull();
    expect(parseInferenceRequest('{"id":"1"}')).toBeNull();
    expect(parseInferenceResponse('{"id":"1","ok":true}')).toBeNull();
  });

  it("decodes complete JSONL lines across chunks", () => {
    const decoder = new JsonLineDecoder();
    expect(decoder.push('{"id":"1"')).toEqual([]);
    expect(decoder.push('}\n{"id":"2"}\npartial')).toEqual([
      '{"id":"1"}',
      '{"id":"2"}',
    ]);
    expect(decoder.push(" line\n")).toEqual(["partial line"]);
  });
});
