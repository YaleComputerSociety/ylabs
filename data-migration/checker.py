#!/usr/bin/env python3
"""
Check which listing professors are NOT in faculty_complete.json.
Reads MONGODBURL_MIGRATION from server/.env and compares against the faculty JSON.
"""

import json
import os
import sys
from urllib.parse import quote_plus

try:
    from pymongo import MongoClient
except ImportError:
    print("[ERROR] pymongo required. Install with: pip install pymongo")
    sys.exit(1)

# Load MONGODBURL_MIGRATION from server/.env
def load_env():
    env_path = os.path.join(os.path.dirname(__file__), "..", "server", ".env")
    env_vars = {}
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                env_vars[key.strip()] = val.strip()
    return env_vars

def normalize(name):
    """Lowercase, strip whitespace and punctuation for fuzzy matching."""
    return name.strip().lower().replace(".", "").replace("-", " ")

def main():
    # Load faculty_complete.json
    faculty_path = os.path.join(os.path.dirname(__file__), "..", "web-scraper", "faculty_complete.json")
    if not os.path.exists(faculty_path):
        print(f"[ERROR] Not found: {faculty_path}")
        sys.exit(1)

    with open(faculty_path, "r", encoding="utf-8") as f:
        faculty = json.load(f)

    # Build lookup sets from faculty data
    # Key by normalized "fname lname", "known_as lname", and email
    faculty_names = set()
    faculty_emails = set()
    faculty_lastnames = set()

    for record in faculty:
        fname = record.get("fname", "").strip()
        lname = record.get("lname", "").strip()
        known_as = record.get("known_as", "").strip()
        email = record.get("email", "").strip().lower()

        if fname and lname:
            faculty_names.add(normalize(f"{fname} {lname}"))
        if known_as and lname:
            faculty_names.add(normalize(f"{known_as} {lname}"))
        if email:
            faculty_emails.add(email)
        if lname:
            faculty_lastnames.add(normalize(lname))

    print(f"Loaded {len(faculty)} faculty records ({len(faculty_names)} unique names)")

    # Connect to ProductionMigration
    env = load_env()
    mongo_url = env.get("MONGODBURL_MIGRATION")
    if not mongo_url:
        print("[ERROR] MONGODBURL_MIGRATION not found in server/.env")
        sys.exit(1)

    client = MongoClient(mongo_url)
    db_name = mongo_url.rsplit("/", 1)[-1].split("?")[0]
    db = client[db_name]

    listings = list(db["listings"].find({}, {
        "title": 1,
        "ownerFirstName": 1,
        "ownerLastName": 1,
        "ownerEmail": 1,
        "professorNames": 1,
        "emails": 1,
    }))
    print(f"Loaded {len(listings)} listings from ProductionMigration\n")

    # Check each listing
    missing = []
    for listing in listings:
        title = listing.get("title", "(no title)")
        owner_first = listing.get("ownerFirstName", "").strip()
        owner_last = listing.get("ownerLastName", "").strip()
        owner_email = (listing.get("ownerEmail") or "").strip().lower()
        prof_names = listing.get("professorNames", [])
        emails = [e.strip().lower() for e in listing.get("emails", []) if e]

        # Check owner
        owner_found = False
        if owner_email and owner_email in faculty_emails:
            owner_found = True
        elif owner_first and owner_last:
            owner_found = normalize(f"{owner_first} {owner_last}") in faculty_names

        # Check all professors
        profs_not_found = []
        for pname in prof_names:
            pname_norm = normalize(pname)
            if pname_norm in faculty_names:
                continue
            # Try matching by last name + email
            found_by_email = any(e in faculty_emails for e in emails)
            if found_by_email:
                continue
            profs_not_found.append(pname)

        if not owner_found or profs_not_found:
            reasons = []
            if not owner_found:
                reasons.append(f"owner: {owner_first} {owner_last} ({owner_email})")
            for p in profs_not_found:
                reasons.append(f"prof: {p}")
            missing.append((title, reasons))

    # Print results
    if missing:
        print(f"=== {len(missing)} listings with professors NOT in faculty_complete.json ===\n")
        for title, reasons in sorted(missing, key=lambda x: x[0]):
            print(f"  {title}")
            for r in reasons:
                print(f"    - {r}")
        print(f"\nTotal: {len(missing)} / {len(listings)} listings")
    else:
        print("All listing professors found in faculty_complete.json!")

    client.close()

if __name__ == "__main__":
    main()
