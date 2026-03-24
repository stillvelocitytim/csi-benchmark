"""Scoring functions for CSI benchmark tasks."""

import json
import logging
import os
import re

log = logging.getLogger("csi-scoring")

# Module-level flag: set to True to enable LLM-as-judge scoring
USE_LLM_JUDGE = True


def score_exact_match(response: str, expected: str) -> float:
    """Extract numbers from response and check if expected value appears."""
    # Normalize expected (strip commas, dollar signs, whitespace)
    expected_clean = expected.replace(",", "").replace("$", "").strip()

    # If expected is non-numeric, do case-insensitive word match
    try:
        float(expected_clean)
    except ValueError:
        # Word-based matching: check if expected word appears in response
        if expected_clean.lower() in response.lower():
            return 1.0
        return 0.0

    # Try to find all numbers in the response
    # Look for the final answer — models often state it at the end
    numbers = re.findall(r'[\d,]+\.?\d*', response.replace(",", ""))

    # Check if expected number appears anywhere
    for num in numbers:
        num_clean = num.replace(",", "").rstrip(".")
        # Compare as floats to handle "5.0" vs "5"
        try:
            if abs(float(num_clean) - float(expected_clean)) < 0.01:
                return 1.0
        except ValueError:
            continue

    return 0.0


def score_code(response: str, task_id: str, checks: list[str]) -> float:
    """Score code responses by checking for required elements."""
    response_lower = response.lower()
    hits = 0
    for check in checks:
        # Each check can have alternatives separated by |
        alternatives = check.lower().split("|")
        if any(alt.strip() in response_lower for alt in alternatives):
            hits += 1

    if not checks:
        return 0.0

    ratio = hits / len(checks)
    if ratio >= 0.8:
        return 1.0
    elif ratio >= 0.5:
        return 0.5
    return 0.0


def score_graded(response: str, criteria: list[str]) -> float:
    """Score graded responses by checking for required conceptual elements."""
    response_lower = response.lower()
    hits = 0
    for criterion in criteria:
        # Each criterion can have alternatives separated by |
        alternatives = criterion.lower().split("|")
        if any(alt.strip() in response_lower for alt in alternatives):
            hits += 1

    if not criteria:
        return 0.0

    ratio = hits / len(criteria)
    if ratio >= 0.9:
        return 1.0
    elif ratio >= 0.5:
        return 0.5
    return 0.0


def score_json_extract(response: str, expected: dict) -> float:
    """Score JSON extraction by checking each field."""
    # Try to find JSON in the response
    json_match = re.search(r'\{[^{}]*\}', response, re.DOTALL)
    if not json_match:
        # Try a more lenient approach — look for multiline JSON
        json_match = re.search(r'\{.*?\}', response, re.DOTALL)
    if not json_match:
        return 0.0

    try:
        extracted = json.loads(json_match.group())
    except json.JSONDecodeError:
        return 0.0

    total_fields = len(expected)
    correct = 0
    for key, expected_val in expected.items():
        if key in extracted:
            actual = str(extracted[key]).strip()
            exp = str(expected_val).strip()
            # Flexible matching: check if expected value is contained in actual
            if exp.lower() in actual.lower() or actual.lower() in exp.lower():
                correct += 1

    return round(correct / total_fields, 2) if total_fields > 0 else 0.0


def score_with_llm(response_text: str, task: dict, judge_model: str = "gpt-4o-mini") -> float:
    """Use an LLM judge to score a response. Falls back to regex scoring on failure."""
    import openai

    task_id = task["task_id"]
    prompt = task["prompt"]
    scoring_type = task["scoring_type"]
    expected = task.get("expected")
    criteria = task.get("grading_criteria") or task.get("code_checks") or []

    system_msg = (
        "You are a precise scoring judge for an AI benchmark. "
        "Score the model's response on a 0.0 to 1.0 scale. "
        "1.0 = fully correct and complete, 0.5 = partially correct, 0.0 = wrong or missing. "
        "Respond with ONLY valid JSON: {\"score\": 0.X, \"reason\": \"brief explanation\"}"
    )

    user_msg = (
        f"TASK PROMPT:\n{prompt}\n\n"
        f"SCORING TYPE: {scoring_type}\n"
    )
    if expected:
        user_msg += f"EXPECTED ANSWER: {expected}\n"
    if criteria:
        user_msg += f"SCORING CRITERIA: {criteria}\n"
    user_msg += f"\nMODEL RESPONSE:\n{response_text}\n\nScore this response."

    try:
        client = openai.OpenAI()
        resp = client.chat.completions.create(
            model=judge_model,
            max_tokens=256,
            temperature=0,
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_msg},
            ],
        )
        judge_text = resp.choices[0].message.content.strip()

        # Parse JSON from judge response
        json_match = re.search(r'\{[^{}]*\}', judge_text)
        if json_match:
            parsed = json.loads(json_match.group())
            score = float(parsed["score"])
            reason = parsed.get("reason", "")
            score = max(0.0, min(1.0, score))
            log.info("  LLM judge (%s) score=%.2f reason=%s", task_id, score, reason[:80])
            return score

        log.warning("  LLM judge: no JSON in response for %s, falling back to regex", task_id)
    except Exception as exc:
        log.warning("  LLM judge failed for %s (%s), falling back to regex", task_id, exc)

    # Fallback to regex-based scoring
    if scoring_type == "code":
        return score_code(response_text, task_id, task.get("code_checks", []))
    elif scoring_type == "graded":
        return score_graded(response_text, task.get("grading_criteria", []))
    return 0.0


def score_task(response: str, task: dict) -> float:
    """Route to the appropriate scoring function based on task type."""
    scoring_type = task["scoring_type"]

    if scoring_type == "exact_match":
        return score_exact_match(response, task["expected"])
    elif scoring_type in ("code", "graded"):
        if USE_LLM_JUDGE:
            return score_with_llm(response, task)
        if scoring_type == "code":
            return score_code(response, task["task_id"], task.get("code_checks", []))
        return score_graded(response, task.get("grading_criteria", []))
    elif scoring_type == "json_extract":
        return score_json_extract(response, task.get("expected", {}))
    else:
        raise ValueError(f"Unknown scoring type: {scoring_type}")
