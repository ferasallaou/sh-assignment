# Mock data

Pretend department sources, a feature catalog and mock identities for the demo.

| File | Source | Format |
|---|---|---|
| `sources/sales/feature_requests.csv` | Sales | CSV, one row per customer request |
| `sources/engineering/tickets.json` | Engineering | JSON array of tickets |
| `sources/product/*.md` | Product | Markdown with front matter |
| `features.yaml` | Feature catalog | The entities records are linked to |
| `policies.yaml` | Identities | Agents (scope, tools) and users (groups) |

## Who can see what (with the roadmap agent)

A record is visible only if the agent's scope allows its source **and** the user is in one of its `allowed_groups`.

| Record | Feature | Linked by | allowed_groups | Paula (product) | Sam (sales) |
|---|---|---|---|---|---|
| S-101 Carrefour request | dark-mode | ID | sales, product | ✅ | ✅ |
| S-102 Esselunga request | dark-mode | alias "night mode" | sales, product | ✅ | ✅ |
| S-103 Lidl at-risk renewal | dark-mode | ID | sales | ❌ | ✅ |
| S-104 Conad request | bulk-export | ID | sales, product | ✅ | ✅ |
| S-105 Auchan request | sso | alias "okta login" | sales, product | ✅ | ✅ |
| ENG-42 Dark mode build | dark-mode | ID | engineering, product | ✅ | ❌ |
| ENG-43 Charts spike | dark-mode | alias "dark theme" | engineering, product | ✅ | ❌ |
| ENG-51 CSV export | bulk-export | ID | engineering, product, sales | ✅ | ✅ |
| ENG-60 SAML login | sso | ID | **missing** | ❌ deny by default | ❌ deny by default |
| PRD-7 Dark mode brief | dark-mode | ID | product, sales, engineering | ✅ | ✅ |
| PRD-9 Q1 roadmap draft | sso, dark-mode, bulk-export | aliases | product | ✅ | ❌ |
| PRD-11 Feedback digest | dark-mode | alias "night mode" | product, sales | ✅ | ✅ |

The narrower `product-faq-agent` sees only Product records (and only the `search_knowledge` tool), whoever the user is.

`PRD-11` contains a planted instruction ("Ignore all previous instructions…") to test that document text is treated as information, never as commands.
