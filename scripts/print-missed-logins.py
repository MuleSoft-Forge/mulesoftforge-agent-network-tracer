#!/usr/bin/env python3
"""
Print ANT Connected App sign-ins from Anypoint Audit Logs.

Requires a bearer token from a user with Organization Administrator or
Audit Log Viewer permission (the ANT Connected App itself cannot query audit logs).

Usage:
  export ANYPOINT_AUDIT_TOKEN='<bearer token from Anypoint UI or API>'
  export ANYPOINT_CLIENT_ID='<ANT connected app client id>'   # optional if in .env
  python3 scripts/print-missed-logins.py

Optional:
  START_DATE=2026-06-17T00:00:00.000Z
  END_DATE=2026-07-21T23:59:59.999Z
  ORG_ID=eca25329-9592-4ff1-9054-1b08d103b991
  ANYPOINT_BASE_URL=https://anypoint.mulesoft.com
  ENRICH_PROFILE=1   # fetch email/name via /accounts/api/profile per unique user
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

DEFAULT_ORG_ID = "eca25329-9592-4ff1-9054-1b08d103b991"
DEFAULT_START = "2026-06-17T00:00:00.000Z"
DEFAULT_END = "2026-07-21T23:59:59.999Z"


def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if not value:
        print(f"Missing required env var: {name}", file=sys.stderr)
        sys.exit(1)
    return value


def request_json(
    method: str,
    url: str,
    token: str,
    body: dict | None = None,
) -> dict:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        print(f"HTTP {exc.code} for {url}\n{detail[:2000]}", file=sys.stderr)
        sys.exit(1)


def payload_props(entry: dict) -> dict:
    payload = entry.get("payload") or {}
    props = payload.get("properties")
    return props if isinstance(props, dict) else (payload if isinstance(payload, dict) else {})


def grant_types(entry: dict) -> str:
    props = payload_props(entry)
    grant = props.get("grantTypes") or props.get("grantType") or ""
    if isinstance(grant, list):
        return ", ".join(str(g) for g in grant)
    return str(grant)


def is_sign_in(entry: dict) -> bool:
    grant = grant_types(entry).lower()
    if not grant:
        return True
    return "authorization_code" in grant


def fetch_audit_page(
    base_url: str,
    org_id: str,
    token: str,
    client_id: str,
    start_date: str,
    end_date: str,
    offset: int,
    limit: int,
) -> dict:
    query = {
        "startDate": start_date,
        "endDate": end_date,
        "platforms": ["CoreServices"],
        "objectTypes": ["Connected Application"],
        "actions": ["Login - Token"],
        "objectIds": [client_id],
        "userIds": [],
        "ascending": True,
        "organizationId": org_id,
        "offset": offset,
        "limit": limit,
    }
    url = f"{base_url}/audit/v2/organizations/{org_id}/query?include_internal=false"
    return request_json("POST", url, token, query)


def fetch_profile(base_url: str, token: str, username: str) -> dict | None:
    # Audit logs give username; profile API is for the signed-in user only.
    # We keep this hook for future admin user lookup APIs; currently unused.
    _ = (base_url, token, username)
    return None


def main() -> None:
    token = env("ANYPOINT_AUDIT_TOKEN")
    client_id = env("ANYPOINT_CLIENT_ID")
    org_id = os.environ.get("ORG_ID", DEFAULT_ORG_ID)
    base_url = os.environ.get("ANYPOINT_BASE_URL", "https://anypoint.mulesoft.com").rstrip("/")
    start_date = os.environ.get("START_DATE", DEFAULT_START)
    end_date = os.environ.get("END_DATE", DEFAULT_END)
    enrich = os.environ.get("ENRICH_PROFILE", "").lower() in {"1", "true", "yes"}

    limit = 200
    offset = 0
    all_entries: list[dict] = []

    while True:
        page = fetch_audit_page(
            base_url, org_id, token, client_id, start_date, end_date, offset, limit
        )
        entries = page.get("data") or page.get("items") or []
        all_entries.extend(entries)
        total = page.get("total")
        if not entries or len(entries) < limit:
            break
        offset += limit
        if isinstance(total, int) and offset >= total:
            break

    sign_ins = [e for e in all_entries if is_sign_in(e)]
    refreshes = [e for e in all_entries if e not in sign_ins]

    print("=" * 72)
    print("ANT missed login audit export")
    print(f"Org:        {org_id}")
    print(f"Client ID:  {client_id}")
    print(f"Range:      {start_date} -> {end_date}")
    print(f"Retrieved:  {len(all_entries)} token events ({len(sign_ins)} sign-ins, {len(refreshes)} other)")
    print("=" * 72)
    print()

    if not sign_ins:
        print("No authorization_code sign-in events found for this Connected App in the date range.")
        if all_entries:
            print("\nOther token events (likely refresh_token):")
            for entry in all_entries:
                print_row(entry)
        return

    print(f"{'#':<4} {'timestamp':<28} {'userName':<24} {'clientIP':<16} grantTypes")
    print("-" * 96)
    for index, entry in enumerate(sign_ins, 1):
        props = payload_props(entry)
        ts = entry.get("timestamp") or entry.get("time") or ""
        user = entry.get("userName") or entry.get("user") or entry.get("username") or ""
        ip = props.get("clientIP", "")
        print(f"{index:<4} {ts:<28} {user:<24} {ip:<16} {grant_types(entry)}")

    print()
    print("Webhook-shaped JSON (username only; enrich email/name manually if needed):")
    print("[")
    for index, entry in enumerate(sign_ins):
        props = payload_props(entry)
        row = {
            "binType": "ant",
            "source": "anypoint_audit_backfill",
            "timestamp": entry.get("timestamp") or entry.get("time"),
            "username": entry.get("userName") or entry.get("user") or entry.get("username"),
            "clientIP": props.get("clientIP"),
            "clientID": props.get("clientID") or client_id,
            "clientName": props.get("clientName"),
            "org_id": props.get("orgID") or org_id,
            "grantTypes": grant_types(entry),
            "email": None,
            "first_name": None,
            "last_name": None,
            "org_name": None,
        }
        suffix = "," if index < len(sign_ins) - 1 else ""
        print(f"  {json.dumps(row, indent=2).replace(chr(10), chr(10) + '  ')}{suffix}")
    print("]")

    if enrich:
        print("\nNote: ENRICH_PROFILE is not implemented — Anypoint profile API returns only the caller.")


def print_row(entry: dict) -> None:
    props = payload_props(entry)
    ts = entry.get("timestamp") or entry.get("time") or ""
    user = entry.get("userName") or entry.get("user") or entry.get("username") or ""
    ip = props.get("clientIP", "")
    print(f"  {ts}  {user}  {ip}  {grant_types(entry)}")


if __name__ == "__main__":
    main()
