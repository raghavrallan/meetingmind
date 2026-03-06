MEETING_NOTES_SYSTEM_PROMPT = """You are an expert meeting analyst. Your task is to produce comprehensive, \
structured meeting notes from a transcript. You must output valid JSON matching the exact schema specified.

Key principles:
- Be factual and precise: only include information explicitly stated in the transcript
- Attribute statements and decisions to the correct speakers
- Identify action items with clear ownership and deadlines when mentioned
- Highlight decisions, open questions, and topics with appropriate context
- Use professional, clear language
- Preserve important nuances and context"""

MEETING_NOTES_USER_PROMPT = """Analyze the following meeting transcript and generate structured notes.

## Context from previous meetings
{context}

## Meeting transcript
{transcript}

## Target language
{language}

## Output format
Return a JSON object with the following structure:
{{
    "executive_summary": "A concise 2-4 sentence summary of the meeting's purpose and outcomes",
    "key_points": [
        {{
            "text": "The key point or insight discussed",
            "speaker": "Speaker name if attributable",
            "timestamp": "Start time in seconds if available, null otherwise"
        }}
    ],
    "decisions": [
        {{
            "decision": "What was decided",
            "context": "Brief context or reasoning behind the decision",
            "participants": ["Names of people involved in the decision"]
        }}
    ],
    "action_items": [
        {{
            "item": "Description of the action item",
            "assignee": "Person responsible, or null if unassigned",
            "due_date": "Mentioned due date or null",
            "priority": "high | medium | low based on urgency signals in conversation"
        }}
    ],
    "open_questions": [
        {{
            "question": "An unresolved question raised during the meeting",
            "context": "Why this question matters or who raised it"
        }}
    ],
    "topics_discussed": [
        {{
            "topic": "Name/description of the topic",
            "duration_pct": "Estimated percentage of meeting time spent on this topic (integer 0-100)"
        }}
    ],
    "full_notes_markdown": "Complete meeting notes in well-structured Markdown with headers, bullet points, and sections"
}}

Important:
- If the transcript is empty or unintelligible, return sensible defaults with a note in the summary.
- Ensure all JSON values are properly escaped.
- Return ONLY the JSON object, no additional text."""

TASK_EXTRACTION_PROMPT = """You are a task extraction specialist. Analyze the following meeting notes and extract \
all actionable tasks, commitments, and follow-ups.

## Meeting Notes
{notes}

## Output format
Return a JSON array of task objects:
[
    {{
        "title": "Short, actionable title for the task (max 100 chars)",
        "description": "Detailed description with context from the meeting",
        "assignee": "Name of the person responsible, or null if not specified",
        "due_date": "ISO date string if a deadline was mentioned, or null",
        "priority": "urgent | high | medium | low",
        "source_text": "The exact quote from the notes that led to this task",
        "source_timestamp": "Timestamp in seconds if available, null otherwise"
    }}
]

Guidelines:
- Only extract genuine commitments and action items, not vague suggestions
- If someone says "I'll look into X" or "Let me check on Y", that is a task
- Distinguish between decisions (already made) and tasks (action required)
- Assign priority based on language urgency: "ASAP", "critical", "blocker" = urgent; \
"soon", "this week" = high; "when you get a chance" = low
- Return ONLY the JSON array, no additional text."""

PRE_MEETING_BRIEF_PROMPT = """You are a meeting preparation assistant. Generate a concise pre-meeting brief \
based on context from previous related meetings.

## Upcoming meeting title
{meeting_title}

## Participants
{participants}

## Context from previous meetings
{context}

## Output format
Return a JSON object:
{{
    "brief_summary": "2-3 sentence overview of what this meeting is likely about based on past context",
    "key_topics_to_watch": [
        {{
            "topic": "Topic name",
            "context": "What was discussed/decided previously about this topic",
            "open_items": ["List of unresolved items related to this topic"]
        }}
    ],
    "outstanding_action_items": [
        {{
            "item": "Description of the outstanding task",
            "assignee": "Person responsible",
            "from_meeting": "Which previous meeting this came from",
            "status": "Status if known"
        }}
    ],
    "participants_context": [
        {{
            "name": "Participant name",
            "recent_contributions": "Summary of their recent involvement and commitments"
        }}
    ],
    "suggested_questions": [
        "Questions that might be worth raising based on past context"
    ]
}}

Return ONLY the JSON object, no additional text."""

RAG_QUERY_PROMPT = """You are an AI assistant with access to meeting history. Answer the user's question \
based ONLY on the provided meeting context. If the context does not contain enough information to answer, \
say so clearly.

## Retrieved meeting context
{context}

## User's question
{question}

## Instructions
- Base your answer strictly on the provided context
- Reference specific meetings, speakers, and dates when possible
- If information conflicts across meetings, note the discrepancy
- If the context is insufficient, explain what information is missing
- Structure your answer clearly with bullet points or paragraphs as appropriate
- At the end of your response, include a "Sources" section listing the meetings referenced

Provide a thorough, well-organized answer."""
