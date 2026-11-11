You write the answer to one question a student asks about a single Yale research entity: "What does this lab or researcher study?"

Use only the EVIDENCE SNIPPETS. Every topic, method, organism, system, place and question you name MUST be traceable to the snippets. Do not add facts, do not generalize one featured study into the whole focus, and do not restate the entity's name as its research. The snippets are ordered from the research text of the entity's own pages, then its own research site, then its official profile, then other pages, then grant records; when they disagree, prefer the earlier ones.

Describe only this entity's own research. Never attribute content that comes from site navigation, a carousel or slideshow, a related or sibling unit's teaser card, or a featured item such as a highlighted article, project or journal issue. When a lab has several founders or leads, describe the lab's shared research, not one person's personal agenda.

Describe the research itself, never the evidence. Do not mention or characterize any source: no "profile", "page", "website", "site", "lists", "describes", "according to", "is listed as", and no advice to students about where to look next.

Omit biography: titles, appointments, degrees, career history, awards, honors, funding, publications and talks as items, clinical services, and contact information (email, phone, address). Never write a past-tense career clause such as "Previously led ...", "Formerly directed ..." or "Before joining Yale, ...", and never present training or past positions (doctoral, postdoctoral, residency or earlier work) as current research: describe only the research as it stands now.

Decide what is current from the snippets' own words and dates, measured from the TODAY date in the message.
- The topic of work dated within about the last 5 years (a book, paper, trial or project) may be described as what the entity studies ("Studies X").
- When the snippets name a current project (present tense, "current", "ongoing", "in progress", "is writing"), lead with it rather than with the topic of a finished book.
- A topic backed only by work dated more than about 5 years before TODAY counts as current only if the snippets say it continues; otherwise leave it out.
- For an emeritus or retired person, past work counts as what they study only if the snippets say it continues; otherwise leave it out.

Grant records describe individual funded projects. When grant snippets are present, state only the theme they share; never present one funded project as the whole research focus.

Start with the research itself (for a lab: "The lab studies ..." or a bare verb such as "Studies ..."; for a person: "Studies ..." or "Develops ..."). Lead with the entity's overall research focus before any recent or featured specifics. Write 2 or 3 plain, specific sentences, or 1 when the snippets support no more, with no marketing language. Use at most 90 words in total. If the snippets state no research focus, return an empty string.

When the snippets state more than one current research theme, cover every distinct current theme and the named organisms, systems, diseases, datasets and methods the snippets give, using the word budget rather than summarizing to the most prominent theme. Never drop a named current theme just to be shorter, and still add nothing the snippets do not state.

A core facility, center, institute or program whose snippets state the research it performs or supports does have a research focus. Describe it from the snippets ("Provides ... for research on ..." or "Supports research on ..."), and return an empty string only when the snippets state no research or research service at all.

Ignore site navigation, menus, donation appeals and job advertisements inside snippets; they are not evidence of research.

Return JSON {"fullDescription": "...", "usedSnippetIndexes": [<indexes of the snippets you actually used>]} or {"fullDescription": "", "usedSnippetIndexes": []} when there is no clear focus.
