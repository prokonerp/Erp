# Prokon ERP — How the System Works (Diagrams)

> **How to read these diagrams**
> - A **box** is a thing (a screen, a file, a database table).
> - A **diamond** is a question or a check ("Is X true?").
> - An arrow shows what happens next. **❌ = stops with an error**, **✅ = success**.
> - Every diagram starts with a one-line *"In plain words"* summary.
> - Technical names are kept in brackets `(like_this)` so you can find them in the code.
>
> These diagrams match the system after the bug-fix hardening pass
> (`BUG_REPORT.md` items B-01…B-26 + SQL migration `20260823100000_bugfix_hardening.sql`).

---

# PART 1 — THE BIG PICTURE

## 1.1 The whole system on one page

*In plain words:* Staff use a website. The website talks to one central database.
Rules that protect money and stock live **inside the database**, not just on screens.

```mermaid
flowchart TB
    subgraph USERS["People who log in"]
        OWNER["Admin / Owner"]
        STAFF["Sales · Service · Accounts staff"]
    end

    subgraph SITE["The Website (runs on Vercel)"]
        PAGES["Screens for every task<br/>(sales, tickets, stock…)"]
        RULES["Business-rule code<br/>(tax math, date logic)"]
    end

    subgraph DB["One Central Database (Supabase)"]
        DATA["All data tables<br/>Every row checked by security rules"]
        GUARDS["Automatic guards (triggers)<br/>Stock, serials and permissions<br/>are enforced HERE, not just on screens"]
        AUTH["Login system"]
    end

    OWNER --> PAGES
    STAFF --> PAGES
    PAGES --> RULES
    RULES -->|"read / save"| DATA
    RULES --> GUARDS
    PAGES --> AUTH

    GIT["Code stored on GitHub"] --- SITE
    VERCEL["Live site:<br/>prokonerp.vercel.app"] --- SITE
```

## 1.2 The modules and how they connect

*In plain words:* A sale starts as a Quotation and flows step-by-step until it becomes an
Invoice. Goods in/out always pass through the Stock tables, which keep a full history.

```mermaid
flowchart LR
    subgraph SELLING["Selling"]
        Q["Quotation<br/>(price offer)"]
        SO["Sales Order<br/>(customer said yes)"]
        INV["Invoice<br/>(the bill)"]
        PAY["Payments received"]
    end

    subgraph MOVING["Moving goods"]
        CH["Delivery Challan<br/>(goods leave)"]
        GRN["Goods Receipt<br/>(goods arrive)"]
        GP["Gatepass"]
    end

    subgraph SERVICEW["Service work"]
        TKT["Tickets"]
        IND["Indent<br/>(ask OEM for part)"]
        AMC["AMC contracts"]
    end

    subgraph STORE["Stock"]
        STK["Stock items<br/>+ full movement history"]
    end

    Q -->|"customer agrees"| SO
    SO -->|"send goods"| CH
    SO -->|"bill it"| INV
    CH -->|"bill later"| INV
    GRN -->|"stock goes UP"| STK
    CH -->|"stock goes DOWN"| STK
    INV -->|"stock goes DOWN"| STK
    TKT --> IND
    TKT -->|"part used"| STK
    AMC --> TKT
    INV --> PAY
```

---

# PART 2 — STEP-BY-STEP FLOWS

## 2.1 Turning a Quotation into an Invoice (safely)

*In plain words:* Each conversion step first checks *"was this already done?"*
If yes, it opens the existing document. Double-clicking can never create duplicates.

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant C as Conversion code
    participant DB as Database

    U->>C: Convert quotation to order
    C->>DB: Does this quote already have an order?
    alt Yes
        DB-->>U: Open the existing order ✅
    else No
        C->>DB: Lock the quote (so no one else converts now)
        C->>DB: Create the Sales Order
        C->>DB: Save link back to the quote
        Note over C,DB: If linking fails → clear error,<br/>retry finds the created order
    end

    U->>C: Make delivery challan from order
    C->>DB: Challan for this order exists?
    alt Yes
        DB-->>U: Open existing challan ✅
    else No
        C->>DB: Create challan + update order status
    end

    U->>C: Make invoice from order / challan
    C->>DB: Invoice already made from this?
    alt Yes
        DB-->>U: Open existing invoice ✅
    else No
        C->>DB: Create invoice header
        C->>DB: Create invoice lines
        Note over C,DB: Lines fail? Delete the header too.<br/>Never leave half an invoice.
    end
```

## 2.2 What happens when someone saves an Invoice

*In plain words:* Before saving, the app checks quantities and serial numbers.
While saving, the database checks stock and permissions again. Anything wrong
stops the save with a clear message — nothing fails silently.

```mermaid
flowchart TD
    START["User clicks Issue Invoice"] --> CHK{"Quick checks:<br/>• quantity filled and sensible?<br/>• serial count matches quantity?<br/>• tax code (HSN) filled?"}
    CHK -->|"something missing"| STOP1["❌ Show what to fix"]
    CHK -->|"all good"| GDC{"Made from a<br/>delivery note (DC)?"}

    GDC -->|"yes"| DUP{"Was this DC<br/>already invoiced?"}
    DUP -->|"yes"| OPEN["Open that invoice ✅<br/>(no double billing, ever)"]
    DUP -->|"no"| SAVE

    GDC -->|"no"| STOCKCHK{"Enough stock?<br/>(app asks the database)"}
    STOCKCHK -->|"check itself failed"| STOP2["❌ Stop and retry.<br/>Never sell without checking."]
    STOCKCHK -->|"not enough"| NEG{"Is user an Admin?"}
    NEG -->|"no"| STOP3["❌ 'Not enough stock'"]
    NEG -->|"yes (with reason)"| SAVE["Save it"]
    STOCKCHK -->|"enough"| SAVE

    SAVE --> HDR["Save invoice header"]
    HDR --> LINES["Save invoice lines<br/>if this fails → delete header too"]
    LINES --> SERIALS{"Database checks each<br/>serial number"}
    SERIALS -->|"serial not in stock"| STOP4["❌ Whole save fails loudly<br/>(phantom sales impossible)"]
    SERIALS -->|"ok"| DEDUCT["Mark units as sold.<br/>Write a stock-history row."]
    DEDUCT --> FROMDC{"Came from a DC?"}
    FROMDC -->|"yes"| MARK["Mark DC as 'Converted'<br/>failure = loud warning:<br/>'do NOT invoice it again'"]
    FROMDC -->|"no"| AUDIT["Log any admin override<br/>failure = visible warning"]
    MARK --> DONE["✅ Done — open the invoice"]
    AUDIT --> DONE
```

## 2.3 Every way stock can change

*In plain words:* Stock never changes secretly. Only these events move it,
and every single movement writes a history row. App code cannot bypass this.

```mermaid
flowchart TB
    subgraph IN["Stock goes UP when…"]
        A1["Goods receipt approved"]
        A2["Transfer received"]
        A3["Cancelled invoice releases units"]
        A4["Cancelled delivery returns units"]
    end

    subgraph OUT["Stock goes DOWN when…"]
        B1["Challan dispatched"]
        B2["General DC issued"]
        B3["Invoice saved with serials/parts"]
        B4["Part issued to a service ticket"]
        B5["Transfer dispatched"]
    end

    HIST[("Movement history table<br/>who · what · when · why")]

    A1 --> HIST
    A2 --> HIST
    A3 --> HIST
    A4 --> HIST
    B1 --> HIST
    B2 --> HIST
    B3 --> HIST
    B4 --> HIST
    B5 --> HIST

    NOTE["Rule: a unit must be AVAILABLE to go out.<br/>If not → the whole action fails with a message.<br/>(No more phantom sales.)"]
```

### Life of one serial-numbered unit

```mermaid
stateDiagram-v2
    [*] --> InStock: goods received
    InStock --> Sold: billed / dispatched / used on ticket
    InStock --> ReturnedToOEM: sent back to company
    Sold --> InStock: invoice cancelled (unit returns)
    Sold --> [*]
```

## 2.4 Money rules

### Recording a payment

*In plain words:* A payment can only be spread across bills up to what each bill
actually owes — checked twice: once on screen, once against fresh data at save time.

```mermaid
flowchart TD
    A["Record payment of ₹X"] --> B{"Each share ≤<br/>that bill's remaining due?"}
    B -->|"no"| STOP["❌ 'Share is more than the due'"]
    B -->|"yes"| C["Re-read dues from database<br/>(someone may have paid meanwhile)"]
    C -->|"changed"| STOP2["❌ 'Refresh and try again'"]
    C -->|"still ok"| D["Save payment"]
    D --> E["Save the shares"]
    E -->|"shares fail"| F["Delete the payment too<br/>(never leave money with no home)"]
    E -->|"saved"| OK["✅"]
```

### Tax (GST) totals — always matching

*In plain words:* The discount at the bottom of an invoice is spread across the
line items using exact paisa math. Screen, printout, saved rows and tax filing
all show the same numbers. Same-state vs other-state tax is decided ONE way:
by comparing GSTIN codes (with state name as backup).

```mermaid
flowchart LR
    IN["Lines + overall discount<br/>+ both parties' GSTIN codes"] --> ENGINE["One shared calculator"]
    ENGINE --> SPLIT["Spread discount across lines<br/>(exact to the paisa)"]
    ENGINE --> SAME{"Same state?<br/>compare GSTIN codes"}
    SAME -->|"yes"| CGST["Charge CGST + SGST<br/>(two halves)"]
    SAME -->|"no"| IGST["Charge IGST (single tax)"]
    SPLIT --> SAMEOUT["Same numbers everywhere:<br/>screen · saved rows · printout · tax file"]
    CGST --> SAMEOUT
    IGST --> SAMEOUT
    QUOTE["Quotations use the<br/>same state rule"] -.-> SAME
```

## 2.5 Salary month cycle

*In plain words:* Attendance is saved together with its audit record. If the audit
fails, the attendance changes are undone automatically — payroll history can
never go missing. Salary math has automated tests.

```mermaid
flowchart TD
    A["Mark attendance"] --> B["Save new values"]
    B --> C["Save audit trail<br/>(old value → new value)"]
    C -->|"audit fails"| D["Undo the attendance change<br/>then show error ✋"]
    C -->|"ok"| E["Calculate salary<br/>tested functions:<br/>present days · Sunday rule · EMI"]
    E --> F["EMI cut can never make<br/>salary negative — leftover<br/>moves to next month"]
    F --> G["Save salary record:<br/>draft → approved → paid"]
    UNDO["Manager clicks Undo"] -->|"restore old values,<br/>mark batch undone"| C
```

## 2.6 Who is allowed to do what

*In plain words:* Screens hide things, but the database decides. Even if someone
bypasses a screen, the database refuses anything their role doesn't allow.

```mermaid
flowchart TD
    REQ["Any request"] --> LOGIN{"Logged in?"}
    LOGIN -->|"no"| NOPE["❌ Blocked"]
    LOGIN -->|"yes"| ROLE["Database asks:<br/>what role does this user have?<br/>admin? … or module permission?"]
    ROLE -->|"admin-only actions:<br/>• allow selling without stock<br/>• delete invoices / tags<br/>• edit salary & advances"| ADMIN_OK["Admins only"]
    ROLE -->|"normal actions per module<br/>(view/create/edit)"| PERM_OK["Allowed by permission"]
    FIRST["First-ever admin setup:<br/>only ONE person can claim it,<br/>even if two click together"]
```

## 2.7 Dates always follow Indian time

*In plain words:* All document dates use Indian Standard Time, so a bill made at
1 AM is dated today, not yesterday. SLA clocks treat Sundays by the Indian calendar,
so everyone sees the same numbers.

```mermaid
flowchart LR
    H["Date helpers<br/>(tested):<br/>today-in-IST · local day · N days ago"]
    DOC["Document dates:<br/>invoice · PO · payment · indent ·<br/>gatepass · challan · GRN"]
    CMP["Comparisons:<br/>AMC expiring soon · overdue returns"]
    SLA["Ticket timers:<br/>skip Sundays by IST calendar"]
    H --> DOC
    H --> CMP
    H --> SLA
```

## 2.8 Main tables and how they relate

*In plain words:* Each document links to the one it came from, so you can always
trace: which quotation became this invoice, and where the money was applied.

```mermaid
erDiagram
    CUSTOMERS ||--o{ QUOTATIONS : "gets"
    QUOTATIONS ||--o| SALES_ORDERS : "becomes"
    SALES_ORDERS ||--o{ DELIVERY_CHALLANS : "ships via"
    SALES_ORDERS ||--o| INVOICES : "billed by"
    GENERAL_DELIVERY_CHALLANS ||--o| INVOICES : "converted to"
    INVOICES ||--|{ INVOICE_ITEMS : "contains"
    PAYMENTS_RECEIVED ||--o{ PAYMENT_ALLOCATIONS : "split into"
    INVOICES ||--o{ PAYMENT_ALLOCATIONS : "receives"

    PRODUCTS ||--o{ IMS_STOCK_ITEMS : "has units"
    WAREHOUSES ||--o{ IMS_STOCK_ITEMS : "stores"
    IMS_STOCK_ITEMS ||--o{ IMS_TRANSACTIONS : "history of"
    GRNS ||--|| IMS_TRANSACTIONS : "creates"

    EMPLOYEES ||--o{ ATTENDANCE : "marks daily"
    EMPLOYEES ||--o{ EMPLOYEE_ADVANCES : "took"
    EMPLOYEE_ADVANCES ||--o{ ADVANCE_PAYMENTS : "repaid monthly"
    EMPLOYEES ||--o{ SALARY_RECORDS : "paid monthly"

    TICKETS ||--o{ TICKET_ACTIVITIES : "history"
    TICKETS ||--o{ INDENTS : "needs parts"
    CUSTOMERS ||--o{ AMCS : "owns"
    AMCS ||--o{ PM_VISITS : "scheduled"
```

## 2.9 What changed in the bug-fix pass (quick reference)

| Situation | Before | Now |
|---|---|---|
| Saving fails halfway through a bill | Half-saved records stayed | Everything rolled back |
| Same delivery billed twice | Possible | Impossible — retry opens the original |
| Selling units not in stock | Sometimes silent | Always blocked with a message |
| Bill made 1–5:30 AM | Dated yesterday | Correct IST date |
| Lists longer than 1000 rows | Quietly cut off | Fully loaded |
| Errors behind the scenes | Hidden | Shown with clear next-step |
| Two people editing/approving at once | Both succeeded | Last-one-wins is detected |

---

## Appendix: Where things live (for engineers)

| Concern | File(s) |
|---|---|
| Pure GST/discount engine | `src/lib/gst.ts` |
| Document mapping (pure) | `src/lib/documentFlow.ts` |
| Document writers (guarded) | `src/lib/documentFlow.writers.ts` |
| IST date helpers | `src/lib/dateRange.ts` |
| Shared same-state rule | `src/lib/crm.ts → isIntraSupply()` |
| Ticket stock issue (claim-first) | `src/lib/ims.ts → issueStockToTicket()` |
| Full-list loading helper | `src/lib/fetchAll.ts → fetchAllWith()` |
| SLA hours (IST Sundays) | `src/lib/tickets.ts → hoursExcludingSundays()` |
| Payroll math (tested) | `src/lib/payroll.ts` |
| Database hardening SQL | `supabase/migrations/20260823100000_bugfix_hardening.sql` |
| Test suite (68 tests) | `src/lib/__tests__/*.test.ts` |
