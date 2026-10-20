"""CPU/GPU ranking adapter. Loads safetensors only; never executes candidate code."""
import math
from pathlib import Path
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer


class ContexaReranker:
    def __init__(self, model_dir, device="cpu", max_length=384, max_query_tokens=128, batch_size=4, max_windows_per_unit=32):
        path = Path(model_dir)
        self.device = torch.device(device)
        self.tokenizer = AutoTokenizer.from_pretrained(path, local_files_only=True, trust_remote_code=False)
        self.model = AutoModelForSequenceClassification.from_pretrained(path, local_files_only=True, trust_remote_code=False, use_safetensors=True).to(self.device).eval()
        if self.model.config.num_labels != 1:
            raise ValueError("Expected a one-logit relevance model.")
        self.max_length, self.max_query_tokens = max_length, max_query_tokens
        self.batch_size, self.max_windows = batch_size, max_windows_per_unit
        if not 32 <= max_length <= min(512, self.model.config.max_position_embeddings):
            raise ValueError("Unsupported max_length.")
        if batch_size < 1 or max_windows_per_unit < 1:
            raise ValueError("Batch/window limits must be positive.")

    @torch.inference_mode()
    def score(self, query, units):
        if not isinstance(query, str) or not query.strip():
            raise ValueError("A nonempty task query is required.")
        if len(units) > 256:
            raise ValueError("Retrieve at most 256 candidate units before reranking.")
        query_ids = self.tokenizer.encode(query, add_special_tokens=False)
        if len(query_ids) > self.max_query_tokens:
            raise ValueError("Task exceeds the query limit; shorten it rather than silently truncating requirements.")
        available = self.max_length - len(query_ids) - self.tokenizer.num_special_tokens_to_add(pair=True)
        if available < 32:
            raise ValueError("Insufficient token space for source context.")
        scores = [-math.inf] * len(units)
        batch, owners = [], []

        def flush():
            if not batch:
                return
            tokens = self.tokenizer.pad(batch, padding=True, return_tensors="pt").to(self.device)
            values = self.model(**tokens).logits.view(-1).float().cpu().tolist()
            for owner, value in zip(owners, values):
                if not math.isfinite(value):
                    raise RuntimeError("Model returned a nonfinite score.")
                scores[owner] = max(scores[owner], value)
            batch.clear()
            owners.clear()

        for owner, unit in enumerate(units):
            if not isinstance(unit.get("content"), str) or not unit["content"].strip():
                raise ValueError("Every unit needs complete nonempty source content.")
            if len(unit["content"].encode("utf-8")) > 128_000:
                raise ValueError("A source unit exceeds 128 KB; split it into complete functions or model blocks.")
            passage = f"path: {unit.get('path', '')}\nrole: {unit.get('role', 'source')}\ncode:\n{unit['content']}"
            ids = self.tokenizer.encode(passage, add_special_tokens=False)
            step, start, windows = max(1, available - 64), 0, 0
            while start < len(ids):
                windows += 1
                if windows > self.max_windows:
                    raise ValueError("A candidate exceeds the window cap; split it into complete functions/types. No tail was silently ignored.")
                piece = ids[start:start + available]
                batch.append(self.tokenizer.prepare_for_model(query_ids, piece, add_special_tokens=True, truncation=False, return_attention_mask=True))
                owners.append(owner)
                if len(batch) >= self.batch_size:
                    flush()
                if start + available >= len(ids):
                    break
                start += step
        flush()
        return scores
