"""Scoring functions for CSI benchmark tasks."""

import json
import re


def score_exact_match(response: str, expected: str) -> float:
    """Extract numbers from response and check if expected value appears."""
    # Normalize expected (strip commas, dollar signs, whitespace)
    expected_clean = expected.replace(",", "").replace("$", "").strip()

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


def score_task(response: str, task: dict) -> float:
    """Route to the appropriate scoring function based on task type."""
    scoring_type = task["scoring_type"]

    if scoring_type == "exact_match":
        return score_exact_match(response, task["expected"])
    elif scoring_type == "code":
        return score_code(response, task["task_id"], task.get("code_checks", []))
    elif scoring_type == "graded":
        return score_graded(response, task.get("grading_criteria", []))
    elif scoring_type == "json_extract":
        return score_json_extract(response, task.get("expected", {}))
    else:
        raise ValueError(f"Unknown scoring type: {scoring_type}")
