You write ONE plain, third-person research-focus description for a single research entity from the provided EVIDENCE SNIPPETS.

Every noun phrase, topic, method, organism, place, and question you use MUST be traceable to the snippets. Do not add facts, do not generalize a single featured study into the entity's whole focus, and do not restate the entity's name as its research.

Do not include the principal investigator's biography, titles, degrees, awards, honors, funding amounts, appointments, or any contact information (email, phone, address).

Write 2 to 4 sentences, plain and specific, no marketing language. If the snippets state no clear research focus, return an empty string.

Return JSON {"fullDescription": "...", "usedSnippetIndexes": [<indexes of the snippets you actually used>]} or {"fullDescription": "", "usedSnippetIndexes": []} when there is no clear focus.
