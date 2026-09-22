# GSP e-Invoice / IRP API Reference — Masters India "Enterprise Solution"

**Source document:** `data/gsp-pdfs/einvoice-api-spec.txt`
**Original title:** "Einvoice API Document : Enterprise Solution" — Company Confidential — MASTERS INDIA PRIVATE LIMITED
**Source extent:** 60 pages, 3,450 lines (~101,400 chars), section markers `===== PAGE 1 =====` … `===== PAGE 60 =====`
**Fidelity rule for this reference:** every URL, JSON key, casing, enum value, length and code below is quoted from that file. Anything the document does **not** state is explicitly marked **`NOT IN DOC`**. Nothing here is inferred from NIC/IRP public knowledge or from the sample values.

> **Read this first.** This document is a **sandbox-only** API doc. It contains **no production host**, **no Content-Type header**, **no token lifetime**, **no rate limits**, **no IP-whitelisting statement**, and **no complete error-code table**. Those gaps are load-bearing for production integration and are enumerated in §12.4 and §14.

---

## 1. Host, protocol and environment

| Item | Value as written in the doc | Source line |
| --- | --- | --- |
| Sandbox host | `https://sandb-api.mastersindia.co` | L8, L27, L2301, L2361, L2540, L2645, L2749, L2785, L2830, L2875, L3244 |
| Production host | **`NOT IN DOC`** — the string `api.mastersindia.co` never appears without the `sandb-` prefix anywhere in the file | grep-verified |
| API version segment | `/api/v1/` on every endpoint | all URLs |
| Protocol | HTTPS only (all URLs) | all URLs |
| Environment evidence | Signed payloads carry `"iss":"NIC Sandbox"` and QR/PDF URLs are `sandb-api.mastersindia.co/...` | L270, L285, L2244(decoded), L295–299 |

**Constraint:** the sandbox host is the only host this document authorises. Do not build a production base-URL constant from this doc — obtain the production host from Masters India separately and record it as a project decision.

---

## 2. Authentication — `#1 : Auth Token`

| Property | Value |
| --- | --- |
| Section | `#1 : Auth Token:` (L6) |
| Method | `POST` (L7) |
| Sandbox URL | `https://sandb-api.mastersindia.co/api/v1/token-auth/` (L8) |
| Production URL | `NOT IN DOC` |
| Auth on this call | none (credential exchange) |
| Content-Type | `NOT IN DOC` (the doc never prints a Content-Type for any endpoint) |

### 2.1 Request JSON — every key

```json
{
  "username": "aman@mastersindia.co",
  "password": "Miitspl@123"
}
```

| Key | Type | Required | Notes |
| --- | --- | --- | --- |
| `username` | string | yes (it is the only credential pair) | example is an e-mail address |
| `password` | string | yes | example value is a plaintext password in the doc |

No other request keys are documented. There is no `grant_type`, no `client_id`, no `client_secret`, no scope.

### 2.2 Success response — the token field

```json
{
  "token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjo2NDYsInVzZXJuYW1lIjoiYW1hbkBtYXN0ZXJzaW5kaWEuY28iLCJleHAiOjE2OTQ3NjM5NjgsImVtYWlsIjoiYW1hbkBtYXN0ZXJzaW5kaWEuY28iLCJvcmlnX2lhdCI6MTY5NDY3NzU2OH0.OE2G-LVpS5auQPuE_ABkKE4ZAJIjSuVIHrPJXIZE1k4"
}
```

| Key | Meaning |
| --- | --- |
| `token` | **this is the exact field name** (lowercase `token`), a JWT |

**Missing at top level:** no `expires_in`, no `token_type`, no `refresh_token`. The response is **not** wrapped in `results`.

### 2.3 Token lifetime

**`NOT IN DOC`.** No validity period, TTL or expiry sentence exists anywhere in the file (grep for `validity|expir|lifetime` returns only the `expiry_date` *item* field and the "24 hours" cancellation rule).

The only lifetime evidence is inside the JWT sample itself: it decodes to `"exp":1694763968` with `"orig_iat":1694677568` — a **72,000-second (20-hour) delta**. That is an observation about a sample token, **not a documented guarantee**. Treat as `UNVERIFIED`; implement refresh-on-401 and do not hard-code 20 hours.

### 2.4 Error response for bad credentials

```json
{
  "error": "Unable to login with provided credential"
}
```

Note the shape: a **top-level `error` string**, no `results` envelope, no numeric `code`. This differs from every other endpoint's failure shape (§6.1).

### 2.5 Auth header format on **all** subsequent calls

The doc writes it consistently as a bare `JWT` scheme with the raw token, **not** `Bearer`:

```
header 'Authorization: JWT <token>'
```

Verbatim instances: L28–31 (`#2`), L2302–2305 (`#3`), L2362–2365 (`#4`), L2543–2546 (`#5`), L2648–2651 (`#6`), L2752–2755 (`#7`), L2787–2790 (`#8`), L2832–2835 (`#9`), L2876–2879 (`#10`), L3246–3249 (`#10A`).

- **Exact scheme token is `JWT`.** `Authorization: Bearer <token>` is **wrong** for this API.
- Section `#8` writes it without wrapping quotes — `header Authorization: JWT <token>` (L2787) — a typographic difference only; the header semantics are identical.
- The Authorization header is the **only** header this document ever shows. `Content-Type: application/json` is never printed, even for the POST calls. Send it, but know the doc does not require it explicitly.

---

## 3. Response envelope convention

Every endpoint **except** `#1` and the `#10` bulk-submit failure wraps its payload in a top-level `results` object:

```json
{
  "results": {
    "message":     { ... result payload ... },
    "errorMessage": "",
    "InfoDtls":     "",
    "status":       "Success",
    "code":         200,
    "requestId":    "<optional, present on generate>"
  }
}
```

| Envelope key | Type | Casing / values observed | Meaning |
| --- | --- | --- | --- |
| `results` | object **or array** | — | array **only** for `#10A` bulk polling |
| `results.message` | **object on success / empty string `""` on failure** | — | the payload; note the type switch, see §11.14 |
| `results.errorMessage` | string | `""` on success; `"<code>: <text>"` on failure | error channel |
| `results.InfoDtls` | string | `""`, or a **JSON-encoded string** carrying e-way-bill sub-errors | see §6.3 |
| `results.status` | string | `"Success"` \| `"Failed"` | only these two observed |
| `results.code` | number | `200` success, `204` failure | observed only |
| `results.requestId` | string | `"<GSTIN>_<docNumber>_<epoch>"` on `#2`; `"edoc_<epoch>_<hex>"` on `#10` submit | correlator |

**Envelope trap:** because `results.message` is an object in the success shape but the string `""` in the failure shape, a client that does `results.message.Irn` will throw on failure. Branch on `results.status`/`results.code` first.

---

## 4. Operation `#2` — Generate Einvoice / IRN

| Property | Value |
| --- | --- |
| Section | `#2: Generate Einvoice / IRN:` (L25) |
| Method | `POST` (L26) |
| Sandbox URL | `https://sandb-api.mastersindia.co/api/v1/einvoice/` (L27) |
| Production URL | `NOT IN DOC` |
| Auth | `Authorization: JWT <token>` (L28) |
| Content-Type | `NOT IN DOC` — the doc presents the body via a curl-style `data '{...}'` (L32) |

### 4.1 Complete request shape (top level)

```text
{
  user_gstin                 string(15)   MANDATORY
  data_source                string       (in examples; NOT IN the parameter table)
  transaction_details        object       REQUIRED
  document_details           object       REQUIRED
  seller_details             object       REQUIRED
  buyer_details              object       REQUIRED
  dispatch_details           object       (optional group)
  ship_details               object       (optional group)
  export_details             object       (optional group)
  payment_details            object       (optional group)
  reference_details          object       (optional group)
  additional_document_details array       (optional group)
  ewaybill_details           object       (optional group)
  value_details              object       REQUIRED
  item_list                  array        REQUIRED
}
```

Schema-declared top-level `Required` array (L2097–2104): `transaction_details`, `document_details`, `seller_details`, `buyer_details`, `item_list`, `value_details`.

**`data_source`**: present as `"data_source": "erp"` in the `#2` example (L34), the `#4` example (L2378) and both `#10` entries (L2883, L3055). It is **absent from the E-Invoicing Parameter Details table and from the JSON Schema**. Only the value `"erp"` is ever shown. Treat as required-by-GSP, undocumented — confirm with Masters India.

### 4.2 Full parameter detail (from "E-Invoicing Parameter Details", L323–932)

`M` = Mandatory column value from the source table (`Y` = Yes, `N` = No, blank = not stated). Lengths are quoted exactly as printed, including the doc's own malformed ranges.

#### `transaction_details` (Mandatory)

| JSON key | Type(size) | M | Allowed values / description |
| --- | --- | --- | --- |
| `supply_type` | String(3-10) | Y | `"B2B"`, `"SEZWP"`, `"SEZWOP"`, `"EXPWP"`, `"EXPWOP"`, `"DEXP"` — B2B Business to Business; SEZWP = with SEZ payment; SEZWOP = SEZ without payment; EXPWP = Export With Payment; EXPWOP = Export without payment; DEXP = Deemed Export |
| `charge_type` | String(1) | N | `"Y"`, `"N"` — "WHETHER the-Y- of liability payable Under the reverse charge" (sic) |
| `igst_on_intra` | String(1) | N | `"Y"`, `"N"` — Y indicates the supply is intra-state but chargeable to IGST. *(The table prints the name as `Igst_on-intra`; the JSON example and schema use `igst_on_intra` — use `igst_on_intra`.)* |
| `ecommerce_gstin` | Text(15) | N | "GSTIN of e-Commerce operator ([0-9]{2}[0-9\|A-Z]{13})" |

#### `document_details` (Mandatory)

| JSON key | Type(size) | M | Allowed values / pattern |
| --- | --- | --- | --- |
| `document_type` | String(3-11) | Y | `"INV"` (Tax Invoice), `"CRN"` (Credit Note), `"DBN"` (Debit Note) |
| `document_number` | String(max 1-16) | Y | `[1-9\|A-Z]{1}[0-9\|A-Z\|/\|-]{15}` |
| `document_date` | String(10) | Y | `[0-3][0-9]/[0-1][0-9]/[2][0][1-2][0-9]` → **DD/MM/YYYY** |

#### `seller_details` (Mandatory)

| JSON key | Type(size) | M | Description |
| --- | --- | --- | --- |
| `gstin` | String(15) | Y | `[0-9]{2}[0-9\|A-Z]{13}` |
| `legal_name` | String(3-100) | Y | Legal Name |
| `trade_name` | String(3-100) | N | Trade name |
| `address1` | String(3-100) | Y | Building / Flat no, Road / Street |
| `address2` | String(3-100) | N | Floor no., premises / building |
| `location` | String(3-50) | Y | Location |
| `pincode` | Number(6) | Y | Pincode |
| `state_code` | String(3-50) | Y | "State Name" (table's own wording; the example passes `"09"`) |
| `phone_number` | String(10-12) | N | Phone or Mobile No. |
| `email` | String(6-100) | N | Email-Id |

#### `buyer_details` (Mandatory)

| JSON key | Type(size) | M | Description |
| --- | --- | --- | --- |
| `gstin` | String(15) | Y | `([0-9]{2}[0-9\|A-Z]{13}) \| PRO` |
| `legal_name` | String(3-100) | Y | Legal Name |
| `trade_name` | String(3-100) | N | Trade name |
| `place_of_supply` | String(1-2) | Y | State code of Place of supply. "If POS lies outside the country, the code shall be 96" |
| `address1` | String(3-100) | Y | Building / Flat no., Road / Street |
| `address2` | String(3-100) | N | Floor no., premises / building |
| `location` | String(3-100) | Y | Location |
| `pincode` | Number(6) | Y | Pincode |
| `state_code` | String(3-50) | Y | State Name |
| `phone_number` | Number(10-12) | N | Phone or Mobile No. |
| `email` | String(6-100) | N | Email-Id |

#### `dispatch_details` (optional group)

| JSON key | Type(size) | M | Description |
| --- | --- | --- | --- |
| `company_name` | String(3-60) | Y | Name of the company from which goods are dispatched |
| `address1` | String(3-100) | Y | Dispatch address 1 |
| `address2` | String(3-100) | N | Dispatch address 2 |
| `location` | String(3-100) | Y | Location |
| `pincode` | Number(6) | Y | Pincode |
| `state_code` | String(1-2) | Y | State code |

#### `ship_details` (optional group)

| JSON key | Type(size) | M | Description |
| --- | --- | --- | --- |
| `gstin` | String(15) | N | `([0-9]{2}[0-9\|A-Z]{13}) \| PRO` |
| `legal_name` | String(3-60) | Y | Legal Name |
| `trade_name` | String(3-60) | N | Trade Name |
| `address1` | String(3-100) | Y | Address 1 of the entity to whom supplies are shipped |
| `address2` | String(3-100) | N | Address 2 |
| `location` | String(3-100) | Y | Place (City, Town, Village) |
| `pincode` | Number(6) | Y | Pincode |
| `state_code` | String(1-2) | Y | State code to which supplies are shipped |

#### `export_details` (optional group)

| JSON key | Type(size) | M | Description |
| --- | --- | --- | --- |
| `ship_bill_number` | String(3-20) | N | Shipping Bill No. |
| `ship_bill_date` | String(10) | N | `[0-3][0-9]/[0-1][0-9]/[2][0][1-2][0-9]` |
| `port_code` | String(2-10) | N | `[0-9\|A-Z\|a-z]{0,10}` |
| `refund_claim` | String(1) | N | Options for Supplier for refund. `Y` / `N` |
| `foreign_currency` | String(3-16) | N | "Additional Currency Code" |
| `country_code` | String(2) | **Y** | Country Code |
| `export_duty` | Number(0-999999999999.99) | N | Export Duty |

#### `payment_details` (all optional)

| JSON key | Type(size) | M | Description |
| --- | --- | --- | --- |
| `bank_account_number` | String(3-18) | N | Bank account number of payee |
| `paid_balance_amount` | Number | N | Amount paid in advance; limit printed as `99,999,999.99` in the table, `9,999,999,999.99` in the schema |
| `credit_days` | Number(0-9999) | N | Credit Days |
| `credit_transfer` | String(3-100) | N | Credit Transfer |
| `direct_debit` | String(3-100) | N | Direct Debit |
| `branch_or_ifsc` | String(3-11) | N | Branch or IFSC code |
| `payment_mode` | String(3-16) | N | "Cash, Credit, Direct Transfer" — example uses `"CASH"` |
| `payee_name` | String(3-100) | N | Payee Name |
| `outstanding_amount` | Number | N | Outstanding amount required to be paid |
| `payment_instruction` | String(3-100) | N | Payment Instruction |
| `payment_term` | String(3-100) | N | Terms of Payment |

#### `reference_details`

| JSON key | Type(size) | M | Description |
| --- | --- | --- | --- |
| `invoice_remarks` | String(3-100) | N | `[0-9\|A-Z\|a-z\|/\|-]{0,100}` Remarks / Note |
| `other_reference` | String(1-20) | N | `[0-9\|A-Z\|a-z\|/\|-()]{20}` |
| `invoice_reference_number` | String(1-20) | N | `[0-9\|A-Z\|a-z\|/\|-()]{20}` |

`reference_details.document_period_details` — nested object:

| JSON key | Type(10) | M | Pattern |
| --- | --- | --- | --- |
| `invoice_period_start_date` | String(10) | **Y** | `[0-3][0-9]/[0-1][0-9]/[2][0][1-2][0-9]` |
| `invoice_period_end_date` | String(10) | **Y** | `[0-3][0-9]/[0-1][0-9]/[2][0][1-2][0-9]` |

`reference_details.preceding_document_details` — **array of objects**:

| JSON key | Type(size) | M | Description |
| --- | --- | --- | --- |
| `reference_of_original_invoice` | String(3-16) | **Y** | Reference of original invoice |
| `preceding_invoice_date` | String(10) | **Y** | `[0-3][0-9]/[0-1][0-9]/[2][0][1-2][0-9]` |
| `other_reference` | String(3-20) | N | Other Reference |

`reference_details` is printed as **`contact_details`** in the parameter table (L637) while containing the contract fields; the JSON example and schema group the same keys under `contract_details` (L126, L1875). See §11.1.

Contract fields (array element, wire key `contract_details`):

| JSON key | Type(size) | M |
| --- | --- | --- |
| `receipt_advice_number` | String(3-20) | N |
| `receipt_advice_date` | String(10) | N |
| `batch_reference_number` | String(3-20) | N |
| `contract_reference_number` | String(3-20) | N |
| `other_reference` | String(3-20) | N |
| `project_reference_number` | String(1-20) | N |
| `vendor_po_reference_number` | String(3-16) | N |
| `vendor_po_reference_date` | String(10) | N |

#### `additional_document_details` — array of objects (all optional)

| JSON key | Type(size) | M | Description |
| --- | --- | --- | --- |
| `supporting_document_url` | String(3-100) | N | Supporting document URL |
| `supporting_document` | String(3-1000) | N | **Supporting document in Base64 format** |
| `additional_information` | String(3-1000) | N | Any additional information |

#### `ewaybill_details`

| JSON key | Type(size) | M | Allowed values / description |
| --- | --- | --- | --- |
| `transporter_id` | String(15) | N | Transin / GSTIN |
| `transporter_name` | String(3-100) | N | Name of the transporter |
| `transportation_mode` | String(1) | **Y** | `"1"` Road, `"2"` Rail, `"3"` Air, `"4"` Ship |
| `transportation_distance` | String(1-4) | **Y** | `^([0-9]\|[1-9][0-9]\|[1-9][0-9][0-9]\|(3)[1-9][0-9][0-9]\|(4)[0][0][0])$` |
| `transporter_document_number` | String(1-15) | N | `[0-9\|A-Z\|a-z\|/\|-]{0,15}` |
| `transporter_document_date` | String(10) | N | `[0-3][0-9]/[0-1][0-9]/[2][0][1-2][0-9]` |
| `vehicle_number` | String(4-20) | N | *(table's Allowed-Values cell says `"O", "R"` — a copy/paste error from `vehicle_type`; §11.7)* |
| `vehicle_type` | String(1) | N | "WHETHER ODC or O-Regular" → `"O"` \| `"R"` |

Schema-declared `Required` inside `ewaybill_details` (L2093–2095): `["transportation_distance"]` only — which **contradicts** the table's `transportation_mode = Y`. See §11.8.

#### `value_details` (Mandatory)

| JSON key | Type(size) | M | Description |
| --- | --- | --- | --- |
| `total_assessable_value` | Number(0-9999999999999.99) | **Y** | Total assessable value of items |
| `total_invoice_value` | Number(0-9999999999999.99) | **Y** | Final Invoice value |
| `total_cgst_value` | Number(0-99,999,999.99) | N | Total value of CGST for items |
| `total_sgst_value` | Number(0-99,999,999.99) | N | Total value of SGST for items |
| `total_igst_value` | Number(0-99,999,999.99) | N | Total value of IGST for items |
| `total_cess_value` | Number(0-99,999,999.99) | N | Total value of cess for items |
| `total_cess_value_of_state` | Number — **declared twice**, as `0-99,999,999.99` (L747) and as `0-9999999999999.99` (L777) | N | Total cess value of state |
| `total_discount` | Number(0-9999999999999.99) | N | Discount |
| `total_other_charge` | Number(0-9999999999999.99) | N | Other Charges |
| `round_off_amount` | Number(-999-9999.99) | N | Rounded off Amount *(schema limits; the validation prose says −99.99 … +99.99 — §11.9)* |
| `total_invoice_value_additional_currency` | Number(0-99,999,999.99) | N | Final Invoice value in Additional Currency |

#### `item_list` (Mandatory) — array of objects

| JSON key | Type(size) | M | Description |
| --- | --- | --- | --- |
| `item_serial_number` | Number(1-6) | **Y** | Serial No. of Item (must be numeric, duplicates rejected) |
| `product_description` | String(3-300) | N | Product Description |
| `is_service` | String(1) | **Y** | `"Y"` if Service, `"N"` if Goods |
| `hsn_code` | String(4-8) | **Y** | HSN Code, min 4 digits, must be valid per GST master |
| `bar_code` | String(3-30) | N | Bar Code |
| `quantity` | Number(1-20) | N | Quantity |
| `free_quantity` | Number(1-20) | N | Free Quantity |
| `unit` | String(3-8) | N | UQC enum — `BAG, BAL, BDL, BKL, BOU, BOX, BTL, BUN, CAN, CBM, CCM, CMS, CTN, DOZ, DRM, GGK, GMS, GRS, GYD, KGS, KLR, KME, LTR, MTR, MLT, MTS, NOS, OTH, PAC, PCS, PRS, QTL, ROL, SET, SQF, SQM, SQY, TBS, TGM, THD, TON, TUB, UGS, UNT, YDS` |
| `unit_price` | Number(0-99,999,999.99) | **Y** | Unit Price / Rate |
| `total_amount` | Number(0-99,999,999.99) | **Y** | Gross Amount (Unit Price × Quantity) |
| `discount` | Number(0-99,999,999.99) | N | Discount |
| `pre_tax_value` | Number(0-9999999999999.99) | N | Pre-tax value |
| `other_charge` | Number(0-99,999,999.99) | N | Other Charges |
| `assessable_value` | Number(0-9999999999999.99) | **Y** | Taxable Value (Total Amount − Discount) |
| `gst_rate` | Number(0-999.999) | **Y** | GST rate as a percentage; "In case of intra-state, the sum of SGST and CGST tax rates should be entered as GST Rate" |
| `igst_amount` | Number(0-99,999,999.99) | N | Amount of IGST payable |
| `cgst_amount` | Number(0-99,999,999.99) | N | Amount of CGST payable |
| `sgst_amount` | Number(0-9999999999999.99) | N | Amount of SGST payable |
| `cess_rate` | *(not in the parameter table; present in schema L1505 and in both examples)* | — | Cess Rate |
| `cess_amount` | Number(0-99,999,999.99) | N | Cess Amount (Advalorem) on basis of quantity and rate |
| `cess_nonadvol_amount` | Number(0-9999999999999.99) | N | Cess Non-Advol Amount |
| `state_cess_rate` | *(not in the parameter table; present in schema L1532 and in both examples)* | — | State Cess Rate |
| `state_cess_amount` | Number(0-99,999,999.99) | N | State Cess Amount |
| `state_cess_nonadvol_amount` | Number(0-99,999,999.99) | N | State Cess Non-Advol Amount |
| `order_line_reference` | String(1-50) | N | Order line reference |
| `country_origin` | String(2) | N | Country Origin |
| `product_serial_number` | String(1-15) | **Y** *(as printed — §11.6)* | Serial number where each item has a unique number |
| `total_item_value` | Number(0-99,999,999.99) | **Y** | Total Item Value (see formula, §8) |
| `batch_details` | object | — | see below |
| `attribute_details` | array of objects | — | `item_attribute_details` String(3-300), `item_attribute_value` String(3-300) |

Schema-declared `Required` for an item (L1621–1630): `item_serial_number`, `is_service`, `hsn_code`, `unit_price`, `total_amount`, `assessable_value`, `gst_rate`, `total_item_value`.

`batch_details` (parameter table L925–932 + schema L1330–1356):

| JSON key | Type(10) | M | Pattern |
| --- | --- | --- | --- |
| `name` | String(3-20) | **Y** | — |
| `expiry_date` | String(10) | N | `[0-3][0-9]/[0-1][0-9]/[2][0][1-2][0-9]` |
| `warranty_date` | String(10) | N | `[0-3][0-9]/[0-1][0-9]/[2][0][1-2][0-9]` |

### 4.3 Verbatim example request body (`#2`)

```json
{
  "user_gstin": "09AAAPG7885R002",
  "data_source": "erp",
  "transaction_details": {
    "supply_type": "B2B",
    "charge_type": "Y",
    "igst_on_intra": "N",
    "ecommerce_gstin": ""
  },
  "document_details": {
    "document_type": "INV",
    "document_number": "TATA/99024",
    "document_date": "14/09/2023"
  },
  "seller_details": {
    "gstin": "09AAAPG7885R002",
    "legal_name": "MastersIndia UP",
    "trade_name": "123",
    "address1": "45",
    "address2": "l45",
    "location": "1279",
    "pincode": 201301,
    "state_code": "09",
    "phone_number": 9876543222,
    "email": ""
  },
  "buyer_details": {
    "gstin": "05AAAPG7885R002",
    "legal_name": "Masters India UK",
    "trade_name": "122",
    "address1": "9",
    "address2": "17843",
    "location": "12321u",
    "pincode": 263001,
    "place_of_supply": "13",
    "state_code": "05",
    "phone_number": "9876599999",
    "email": ""
  },
  "dispatch_details": {
    "company_name": "Sample test",
    "address1": "Vila",
    "address2": "Vila",
    "location": "Noida",
    "pincode": 201301,
    "state_code": "09"
  },
  "ship_details": {
    "gstin": "05AAAPG7885R002",
    "legal_name": "Sample test1",
    "trade_name": "Sample test2",
    "address1": "Villa 3322 Test",
    "address2": "",
    "location": "Dehradun",
    "pincode": 263001,
    "state_code": "5"
  },
  "export_details": {
    "ship_bill_number": "",
    "ship_bill_date": "",
    "country_code": "IN",
    "foreign_currency": "INR",
    "refund_claim": "N",
    "port_code": "12",
    "export_duty": "90.9"
  },
  "payment_details": {
    "bank_account_number": "Account Details",
    "paid_balance_amount": "100.2",
    "credit_days": 2,
    "credit_transfer": "Credit Transfer",
    "direct_debit": "Direct Debit",
    "branch_or_ifsc": "KKK000180",
    "payment_mode": "CASH",
    "payee_name": "Payee Name",
    "outstanding_amount": "1.9",
    "payment_instruction": "Payment Instruction",
    "payment_term": "Terms of Payment"
  },
  "reference_details": {
    "invoice_remarks": "Invoice Remarks",
    "document_period_details": {
      "invoice_period_start_date": "07/03/2020",
      "invoice_period_end_date": "07/03/2020"
    },
    "preceding_document_details": [
      {
        "reference_of_original_invoice": "CFRT/0006",
        "preceding_invoice_date": "07/03/2020",
        "other_reference": "2334"
      }
    ],
    "contract_details": [
      {
        "receipt_advice_number": "aaa23e4",
        "receipt_advice_date": "07/03/2020",
        "batch_reference_number": "2334",
        "contract_reference_number": "2334",
        "other_reference": "2334",
        "project_reference_number": "2334",
        "vendor_po_reference_number": "233433454545",
        "vendor_po_reference_date": "07/02/2020"
      }
    ]
  },
  "additional_document_details": [
    {
      "supporting_document_url": "asafsd",
      "supporting_document": "india",
      "additional_information": "india"
    }
  ],
  "ewaybill_details": {
    "transporter_id": "05AAABB0639G1Z8",
    "transporter_name": "Jay Trans",
    "transportation_mode": "1",
    "transportation_distance": 296,
    "transporter_document_number": "12301",
    "transporter_document_date": "14/09/2023",
    "vehicle_number": "PQR1234",
    "vehicle_type": "R"
  },
  "value_details": {
    "total_assessable_value": 4,
    "total_cgst_value": "",
    "total_sgst_value": 0,
    "total_igst_value": 0.2,
    "total_cess_value": 0,
    "total_cess_value_of_state": 0,
    "total_discount": 0,
    "total_other_charge": 0,
    "total_invoice_value": 4.2,
    "round_off_amount": 0,
    "total_invoice_value_additional_currency": 0
  },
  "item_list": [
    {
      "item_serial_number": "501",
      "product_description": "Wheat desc",
      "is_service": "N",
      "hsn_code": "1001",
      "bar_code": "1212",
      "quantity": 1,
      "free_quantity": 0,
      "unit": "KGS",
      "unit_price": 4,
      "total_amount": 4,
      "pre_tax_value": 0,
      "discount": 0,
      "other_charge": 0,
      "assessable_value": 4,
      "gst_rate": 5,
      "igst_amount": 0.2,
      "cgst_amount": 0,
      "sgst_amount": 0,
      "cess_rate": 0,
      "cess_amount": 0,
      "cess_nonadvol_amount": 0,
      "state_cess_rate": 0,
      "state_cess_amount": 0,
      "state_cess_nonadvol_amount": 0,
      "total_item_value": 4.2,
      "country_origin": "",
      "order_line_reference": "",
      "product_serial_number": "",
      "batch_details": {
        "name": "aaa",
        "expiry_date": "31/10/2020",
        "warranty_date": "31/10/2020"
      },
      "attribute_details": [
        { "item_attribute_details": "aaa", "item_attribute_value": "147852" }
      ]
    }
  ]
}
```

Note the source's own type inconsistency: `item_serial_number` is documented as `Number` but passed as the **string** `"501"`; `transportation_distance` is documented as `String` but passed as the **number** `296`; `total_cgst_value` is passed as `""` (empty string) for a field typed `Number`; `paid_balance_amount` / `outstanding_amount` / `export_duty` are passed as strings. Normalise types in the client; see §11.5.

### 4.4 Success response (`#2`) — every field

```json
{
  "results": {
    "message": {
      "AckNo": 142310015934386,
      "AckDt": "2023-09-14 13:20:56",
      "Irn": "d812d43cf9a8951e25973390fcd2b2fbaa4786e779a277768422e7302d50fcde",
      "SignedInvoice": "<base64 JWT — see source lines 222–276>",
      "SignedQRCode": "<base64 JWT — see source lines 277–290>",
      "EwbNo": 471008880909,
      "EwbDt": "2023-09-14 13:21:00",
      "EwbValidTill": "2023-09-16 23:59:00",
      "QRCodeUrl": "https://sandb-api.mastersindia.co/api/v1/einvoice/qrcode/anVsX3NlcF8yMDIzLTI0-6502bc57b5f34bd57e404e6f/",
      "EinvoicePdf": "https://sandb-api.mastersindia.co/api/v1/einvoice/pdf/anVsX3NlcF8yMDIzLTI0-6502bc57b5f34bd57e404e6f/",
      "EwaybillPdf": "https://sandb-api.mastersindia.co/api/v1/detailPrintPdf/anVsX3NlcF8yMDIzLTI0-6502bc57b5f34bd57e404e71/",
      "Status": "ACT",
      "Remarks": "",
      "alert": "",
      "error": false
    },
    "errorMessage": "",
    "InfoDtls": "",
    "status": "Success",
    "code": 200,
    "requestId": "09AAAPG7885R002_TATA/99024_1694678102"
  }
}
```

**Confirmed exact casing of every field you asked about** (all inside `results.message`):

| Requested field | Exact key in doc | Casing note |
| --- | --- | --- |
| `Irn` | `Irn` | mixed case, not `IRN` |
| `AckNo` | `AckNo` | number |
| `AckDt` | `AckDt` | `"YYYY-MM-DD HH:MM:SS"` (24-hour, no timezone) |
| `SignedInvoice` | `SignedInvoice` | base64 JWT string |
| `SignedQRCode` | `SignedQRCode` | base64 JWT string |
| `Status` | `Status` | `"ACT"` observed |
| `EwbNo` | `EwbNo` | number on success, `null` when no e-way bill |
| `EwbDt` | `EwbDt` | `"YYYY-MM-DD HH:MM:SS"` |
| `EwbValidTill` | `EwbValidTill` | `"YYYY-MM-DD HH:MM:SS"` |
| `QRCodeUrl` | `QRCodeUrl` | **present in `#2` and `#10A`; ABSENT from `#5` and `#6` payloads** |
| `EinvoicePdf` | `EinvoicePdf` | idem |
| `EwaybillPdf` | `EwaybillPdf` | idem |
| extra | `Remarks`, `alert` (lowercase), `error` (boolean) | `#5`/`#6` use `"Remarks": null`; `#7` uses `Alert` **capital A** |

`Status` values seen anywhere in the doc: `"ACT"` only. No other IRN status value is documented.

### 4.5 Failure response (`#2`)

```json
{
  "results": {
    "message": "",
    "errorMessage": "3038: Seller details Details:Pincode-101301 does not exists",
    "InfoDtls": "",
    "status": "Failed",
    "code": 204,
    "requestId": "09AAAPG7885R002_TATA/99025_1694678229"
  }
}
```

---

## 5. Operation `#3` — Cancel Einvoice / IRN

| Property | Value |
| --- | --- |
| Section | `#3: Cancel Einvoice / IRN:` (L2299) |
| Method | `POST` (L2300) |
| Sandbox URL | `https://sandb-api.mastersindia.co/api/v1/cancel-einvoice/` (L2301) |
| Production URL | `NOT IN DOC` |
| Auth | `Authorization: JWT <token>` (L2302) |

### 5.1 Request — exact fields

```json
{
  "user_gstin": "09AAAPG7885R002",
  "irn": "ac58d64d47b8816e444deb35c27477dea18d630a34e3c2f59a2aa0e86c70629e",
  "cancel_reason": "1",
  "cancel_remarks": "Wrong entry",
  "ewaybill_cancel": ""
}
```

| Field | Type | Documented where | Notes |
| --- | --- | --- | --- |
| `user_gstin` | string(15) | example only | not in the cancel JSON Schema |
| `irn` | string | example **and** JSON Schema (L2341) | "IRN number" |
| `cancel_reason` | string | example **and** JSON Schema (L2345) | "Cancel reason" — **example value `"1"`; the doc gives NO reason-code table and no list of valid values** |
| `cancel_remarks` | string | example **and** JSON Schema (L2349) | "Cancel Remarks" — example `"Wrong entry"` |
| `ewaybill_cancel` | string | example only | example `""`; semantics not documented (presumably cancels the linked e-way bill) |

**No maximum length, pattern or mandatory marking is given for any cancel field.** The schema has no `required` array.

### 5.2 Cancellation window and rules (verbatim, L2355–2358)

1. "IRN can be cancel within 24 hours of IRN generation."
2. "IRN cannot be cancel, if the Valid/Active E-way Bill exists for the same."
3. "Cancellation can be done by active or suspended taxpayers."

### 5.3 Success response

```json
{
  "results": {
    "message": {
      "Irn": "ac58d64d47b8816e444deb35c27477dea18d630a34e3c2f59a2aa0e86c70629e",
      "CancelDate": "2023-09-14 13:29:00"
    },
    "errorMessage": "",
    "InfoDtls": "",
    "status": "Success",
    "code": 200
  }
}
```

Cancel success returns only `Irn` and `CancelDate` — **no `AckNo`, no `Status`, and no `requestId`**.

### 5.4 Failure response

```json
{
  "results": {
    "message": "",
    "errorMessage": "2143: Invoice does not belongs to the user GSTIN",
    "InfoDtls": "",
    "status": "Failed",
    "code": 204
  }
}
```

---

## 6. Operation `#4` — Generate e-Way Bill by IRN

| Property | Value |
| --- | --- |
| Section | `#4: Generate e-Way Bill by IRN` (L2359) |
| Method | `POST` (L2360) |
| Sandbox URL | `https://sandb-api.mastersindia.co/api/v1/gen-ewb-by-irn/` (L2361) |
| Production URL | `NOT IN DOC` |
| Auth | `Authorization: JWT <token>` (L2362) |

### 6.1 Request

```json
{
  "user_gstin": "09AAAPG7885R002",
  "irn": "dd609070d4f3f66f1585fc13abd52e8f47d4102c8389bb9f7411afe52a9e778a",
  "transporter_id": "05AAABB0639G1Z8",
  "transportation_mode": "1",
  "transporter_document_number": "12345",
  "transporter_document_date": "14/09/2023",
  "vehicle_number": "KA01AB1234",
  "distance": 256,
  "vehicle_type": "R",
  "transporter_name": "Jay Trans",
  "data_source": "erp",
  "dispatch_details": {
    "company_name": "dqfefkewl",
    "address1": "Vila",
    "address2": "Vila",
    "location": "Noida",
    "pincode": 201301,
    "state_code": "09"
  },
  "ship_details": {
    "address1": "PILA 1",
    "address2": "PILA 1",
    "location": "Nainital",
    "pincode": 248001,
    "state_code": "UTTARAKHAND"
  }
}
```

| Field | Type | Req (example) | Req (schema) | Description |
| --- | --- | --- | --- | --- |
| `user_gstin` | string(15) | yes | not in schema | example only |
| `irn` | string | yes | not in schema `required` | IRN number |
| `transporter_id` | string(15) | — | — | Transin / GSTIN |
| `transporter_name` | string(3-100) | — | — | Name of the transporter |
| `transportation_mode` | string(1) | `"1"` | **required** (L2497–2499) | Road-1, Rail-2, Air-3, Ship-4 |
| `distance` | string (schema) / number `256` (example) | yes | — | Distance between source and destination PIN codes. **Note the key is `distance` here, not `transportation_distance` as in `#2`.** |
| `transporter_document_number` | string(1-15) | — | — | `^([0-9A-Z-a-z/]){1,15}$` |
| `transporter_document_date` | string(10) | — | — | `[0-3][0-9]/[0-1][0-9]/[2][0][1-2][0-9]` |
| `vehicle_number` | string(4-20) | — | — | Vehicle Number |
| `vehicle_type` | string(1) | — | — | `"O"` ODC / `"R"` Regular |
| `data_source` | string | yes | not in schema | `"erp"` |
| `dispatch_details` | object | — | — | same shape as `#2` |
| `ship_details` | object | — | — | same shape as `#2` — note `"state_code": "UTTARAKHAND"` here, a **state name**, whereas `#2` passes `"09"` |

Schema declares only `transportation_mode` required; the validation prose adds "E-waybill can be generated only if E-way Bill related details are passed **where distance is mandatory**" (§7, rule 1).

### 6.2 Success response

```json
{
  "results": {
    "message": {
      "EwbNo": 401008880911,
      "EwbDt": "2023-09-14 13:36:00",
      "EwbValidTill": "2023-09-16 23:59:00",
      "Remarks": "",
      "QRCodeUrl": "https://sandb-api.mastersindia.co/api/v1/einvoice/qrcode/anVsX3NlcF8yMDIzLTI0-6502bfc0b5f34bd57e404e75/",
      "EinvoicePdf": "https://sandb-api.mastersindia.co/api/v1/einvoice/pdf/anVsX3NlcF8yMDIzLTI0-6502bfc0b5f34bd57e404e75/",
      "EwaybillPdf": "https://sandb-api.mastersindia.co/api/v1/detailPrintPdf/anVsX3NlcF8yMDIzLTI0-6502bfe6b5f34bd57e404e77/"
    },
    "errorMessage": "",
    "InfoDtls": "",
    "status": "Success",
    "code": 200
  }
}
```

**No `Irn`, no `AckNo`, no `Status` in this response.**

### 6.3 Failure response

```json
{
  "results": {
    "message": "",
    "errorMessage": "2302: Status of the IRN is not active",
    "InfoDtls": "",
    "status": "Failed",
    "code": 204
  }
}
```

---

## 7. Operations `#5`, `#6`, `#7` — Read operations

### 7.1 `#5: Get Einvoice Details By IRN`

| Property | Value |
| --- | --- |
| Method | `GET` (L2538) |
| Sandbox URL | `https://sandb-api.mastersindia.co/api/v1/get-einvoice?gstin=09AAAPG7885R002&irn=dd609070d4f3f66f1585fc13abd52e8f47d4102c8389bb9f7411afe52a9e778a` (L2540–2542) |
| Production URL | `NOT IN DOC` |
| Query params | `gstin`, `irn` — **note: `gstin`, NOT `user_gstin`** (contrast `#6`/`#7`) |
| Auth | `Authorization: JWT <token>` (L2543) |
| Validity | "IRN can be retrieved using this API within three days from the date of generation of IRN." (L2641) |

Success `results.message` contains: `AckNo`, `AckDt`, `Irn`, `SignedInvoice`, `SignedQRCode`, `Status`, `EwbNo`, `EwbDt`, `EwbValidTill`.

**Absent from this response** (present in `#2`/`#4`): `QRCodeUrl`, `EinvoicePdf`, `EwaybillPdf`, `Remarks`, `alert`, `error`.

Failure:

```json
{ "results": { "message": "", "errorMessage": "2148: Requested IRN data is not available", "InfoDtls": "", "status": "Failed", "code": 204 } }
```

### 7.2 `#6: Get Einvoice Details By Doc Details`

| Property | Value |
| --- | --- |
| Method | `GET` (L2644) |
| Sandbox URL | `https://sandb-api.mastersindia.co/api/v1/get-einvoice-bydoc?user_gstin=09AAAPG7885R002&document_type=INV&document_number=TATAF99027&document_date=14/09/2023` (L2645–2647) |
| Production URL | `NOT IN DOC` |
| Query params | `user_gstin`, `document_type`, `document_number`, `document_date` (date as **`DD/MM/YYYY`**, unencoded `/`) |
| Auth | `Authorization: JWT <token>` (L2648) |
| Stated validity window | `NOT IN DOC` (only `#5` states a 3-day window) |

Success `results.message`: same field set as `#5` **plus** `"Remarks": null`.

Failure:

```json
{ "results": { "message": "", "errorMessage": "2154: IRN details are not found", "InfoDtls": "", "status": "Failed", "code": 204 } }
```

### 7.3 `#7: Get e-Waybill Details by IRN`

| Property | Value |
| --- | --- |
| Method | `GET` (L2748) |
| Sandbox URL | `https://sandb-api.mastersindia.co/api/v1/get-ewb-byirn?user_gstin=09AAAPG7885R002&irn=dd609070d4f3f66f1585fc13abd52e8f47d4102c8389bb9f7411afe52a9e778a` (L2749–2751) |
| Production URL | `NOT IN DOC` |
| Query params | `user_gstin`, `irn` |
| Auth | `Authorization: JWT <token>` (L2752) |
| Note | The source renders the URL line as `URL: curl --location 'https://…'` — a curl artefact, not a different endpoint |

Success — **different key set from every other read**:

```json
{
  "results": {
    "message": {
      "EwbNo": 401008880911,
      "Status": "ACT",
      "GenGstin": "09AAAPG7885R002",
      "EwbDt": "2023-09-14 13:36:00",
      "EwbValidTill": "2023-09-16 23:59:00",
      "Alert": ""
    },
    "errorMessage": "",
    "InfoDtls": "",
    "status": "Success",
    "code": 200
  }
}
```

`GenGstin` is unique to this endpoint. `Alert` is **capital-A** here but `alert` lowercase in `#2`.

Failure:

```json
{ "results": { "message": "", "errorMessage": "4005: Eway Bill details are not found", "InfoDtls": "", "status": "Failed", "code": 204 } }
```

---

## 8. GSTIN verification — `#8` Get GSTIN Details, `#9` Sync GSTIN Details from CP

Both return **byte-identical field sets** in the documented samples; `#9` is a refresh-from-CP (Common Portal) sibling of `#8`.

### 8.1 `#8: Get GSTIN Details`

| Property | Value |
| --- | --- |
| Method | `GET` (L2784) |
| Sandbox URL | `https://sandb-api.mastersindia.co/api/v1/get-gstin-details?user_gstin=09AAAPG7885R002&gstin=05AAAPG7885R002` (L2785–2786) |
| Production URL | `NOT IN DOC` |
| Query params | `user_gstin` (the API user's own GSTIN), `gstin` (the GSTIN being looked up) |
| Auth | `header Authorization: JWT <token>` (L2787 — no wrapping quotes in the source) |

### 8.2 `#9: Sync GSTIN Details from CP`

| Property | Value |
| --- | --- |
| Method | `GET` (L2829) |
| Sandbox URL | `https://sandb-api.mastersindia.co/api/v1/sync-gstin?user_gstin=09AAAPG7885R002&gstin=05AAAPG7885R002` (L2830–2831) |
| Production URL | `NOT IN DOC` |
| Query params | `user_gstin`, `gstin` |
| Auth | `Authorization: JWT <token>` (L2832) |

### 8.3 Success response (identical for `#8` and `#9`)

```json
{
  "results": {
    "message": {
      "Gstin": "05AAAPG7885R002",
      "TradeName": null,
      "LegalName": "Masters India Private Limited",
      "AddrBnm": null,
      "AddrBno": null,
      "AddrFlno": null,
      "AddrSt": null,
      "AddrLoc": null,
      "StateCode": 5,
      "AddrPncd": 560009,
      "TxpType": "REG",
      "Status": "ACT",
      "BlkStatus": "U",
      "DtReg": null,
      "DtDReg": null
    },
    "errorMessage": "",
    "InfoDtls": "",
    "status": "Success",
    "code": 200
  }
}
```

| Field | Meaning | Observed value | Notes |
| --- | --- | --- | --- |
| `Gstin` | the looked-up GSTIN | `"05AAAPG7885R002"` | |
| `LegalName` | legal name | `"Masters India Private Limited"` | |
| `TradeName` | trade name | `null` | nullable |
| `AddrBnm` | building name | `null` | |
| `AddrBno` | building number | `null` | |
| `AddrFlno` | floor number | `null` | |
| `AddrSt` | street | `null` | |
| `AddrLoc` | location | `null` | |
| `StateCode` | state code | `5` (**number**, not zero-padded string) | |
| `AddrPncd` | pincode | `560009` (number) | |
| `TxpType` | **taxpayer type** | `"REG"` | only `"REG"` is ever shown; the validation prose independently mentions taxpayer types `SEZ Unit`, `SEZ Developer`, `ISD`, `Regular`, `Casual`, `TCS`, `REG`, `SED` (§9) |
| `Status` | registration status | `"ACT"` | |
| `BlkStatus` | blocked status | `"U"` | only `"U"` is ever shown; no legend in the doc |
| `DtReg` | date of registration | `null` | |
| `DtDReg` | date of de-registration | `null` | |

**`AddrPncd` example (`560009`) contradicts `StateCode` (`5`)** — PIN 560009 is Karnataka (state code 29), not Gujarat (05). Treat the sample as illustrative only.

### 8.4 Failure responses

`#8`:
```json
{ "results": { "message": "", "errorMessage": "3001: Requested data is not available", "InfoDtls": "", "status": "Failed", "code": 204 } }
```

`#9`:
```json
{ "results": { "message": "", "errorMessage": "5001: Application Error in Auth, Please Contact the help desk", "InfoDtls": "", "status": "Failed", "code": 204 } }
```

---

## 9. Bulk generation — `#10` + `#10A`

### 9.1 `#10: Generate E-Invoice in Bulk`

| Property | Value |
| --- | --- |
| Section | `#10: Generate E-Invoice in Bulk` (L2873) |
| Method | `Post` (L2874 — written with that casing) |
| Sandbox URL | `https://sandb-api.mastersindia.co/api/v1/einvoiceGenerateInBulk/` (L2875 — the source wraps it in a quote and a trailing space: `'…/ ’`) |
| Production URL | `NOT IN DOC` |
| Auth | `Authorization: JWT <token>` (L2876) |

**Batching:** the body is a single top-level object with exactly one key, `einvoice_list`, whose value is an **array of complete e-invoice payloads** — each element has the **same shape as the entire `#2` request body** (including its own `user_gstin` and `data_source`). The example submits **2 records**.

**Maximum batch size: `NOT IN DOC`.** No max-batch, max-items or max-payload statement appears for bulk (the only size limit in the whole document is the 2 MB JSON payload rule, L2178, stated under `#2` validations).

```json
{
  "einvoice_list": [ { /* full #2-shaped invoice */ }, { /* full #2-shaped invoice */ } ]
}
```

Documented example entries: `document_number` `"TATA/A/0011"` (L2893) and `"TATA/A/0012"` (L3064); both use `"transportation_distance": 4000` (L2993, L3165) and `"foreign_currency": "inr"` (lowercase, unlike `#2`'s `"INR"`).

### 9.2 Submit — success response (**shape differs from `#2`**)

```json
{
  "results": {
    "status": "Success",
    "message": "Request has been accepted.Please get response by the request id",
    "code": 200,
    "request_status": "pending",
    "requestId": "edoc_1694681573_7a4d44de71b7"
  }
}
```

- `results.message` here is a **plain string**, not an object.
- `results.request_status` = `"pending"` — **this is the only documented async state value**.
- `results.requestId` format `edoc_<epoch>_<12-hex>`.
- No `errorMessage`, no `InfoDtls` in the documented bulk-submit response.

### 9.3 Submit — failure response (**no `results` envelope**)

```json
{
  "error": "invalid_request",
  "error_description": "Invalid Json Structure."
}
```

This is a **third distinct failure shape** (after `#1`'s `{"error": …}` and the standard `results` envelope).

### 9.4 `#10A: Get Bulk E-Invoice Response` — polling

| Property | Value |
| --- | --- |
| Section | `#10A: Get Bulk E-Invoice Response:` (L3243) |
| Method | **`NOT IN DOC`** — `#10A` prints only `URL:` and `header 'Authorization: …'`; there is no `Method:` line. The URL is query-param style (`?request_id=…`), consistent with `GET`, but the doc never states it. |
| Sandbox URL | `https://sandb-api.mastersindia.co/api/v1/getBulkEinvoiceResponse?request_id=edoc_1694681573_7a4d44de71b7` (L3244–3245) |
| Production URL | `NOT IN DOC` |
| Query params | `request_id` (the `requestId` returned by `#10`) |
| Auth | `Authorization: JWT <token>` (L3246) |

**Polling model:** submit → receive `requestId` + `request_status: "pending"` → poll `getBulkEinvoiceResponse?request_id=<requestId>` until `results` is a **non-empty array**.

### 9.5 Poll — success response (`results` is an ARRAY)

```json
{
  "results": [
    {
      "message": {
        "AckNo": 142310015934535,
        "AckDt": "2023-09-14 14:18:46",
        "Irn": "dd7c08b14f1c764e2d21343afd6c32003d6b56ba688c32b62c82c7c308e83600",
        "SignedInvoice": "<base64 JWT — source lines 3258–3313>",
        "SignedQRCode": "<base64 JWT — source lines 3314–3326>",
        "EwbNo": null,
        "EwbDt": null,
        "EwbValidTill": null,
        "QRCodeUrl": "https://sandb-api.mastersindia.co/api/v1/einvoice/qrcode/anVsX3NlcF8yMDIzLTI0-6502c9e6fa85d5eadddd5162/",
        "EinvoicePdf": "https://sandb-api.mastersindia.co/api/v1/einvoice/pdf/anVsX3NlcF8yMDIzLTI0-6502c9e6fa85d5eadddd5162/",
        "Status": "ACT",
        "Remarks": "",
        "alert": "",
        "error": false
      },
      "errorMessage": "",
      "InfoDtls": "[{\"InfCd\": \"EWBERR\", \"Desc\": [{\"ErrorCode\": \"4013\", \"ErrorMessage\": \"The distance between the pincodes given is too high or low.\"}]}]",
      "status": "Success",
      "code": 200,
      "requestId": "09AAAPG7885R002_TATA/A/0011_1694681573"
    }
  ]
}
```

**Critical bulk semantics.** In this sample the e-way bill **failed** (`EwbNo`/`EwbDt`/`EwbValidTill` are `null`) yet the record reports `"status": "Success"`, `"code": 200`, `"error": false` and a valid `Irn`. The **only** signal of the e-way-bill failure is the `InfoDtls` JSON string. Bulk code that only checks `status`/`code` will silently mark an invoice "fully generated" while no e-way bill exists.

`InfoDtls` decodes to:

```json
[{"InfCd": "EWBERR", "Desc": [{"ErrorCode": "4013", "ErrorMessage": "The distance between the pincodes given is too high or low."}]}]
```

| InfoDtls key | Meaning |
| --- | --- |
| `InfCd` | info code; only `"EWBERR"` is observed |
| `Desc[].ErrorCode` | string error code, e.g. `"4013"` |
| `Desc[].ErrorMessage` | human-readable text |

Both example entries carry the identical `4013`/EWBERR payload (L3340–3341, L3434–3435) — except the first record's `#2`-equivalent single call earlier succeeded with an e-way bill, so treat `4013` as the documented "distance too high or low" code.

### 9.6 Poll — failure response

```json
{
  "results": {
    "error": true,
    "code": 204,
    "request_status": "",
    "message": "No records found."
  }
}
```

Note `"request_status"` is an **empty string** here (`""`), whereas the submit response used `"pending"` — no other `request_status` value is documented anywhere.

**Ambiguity to resolve with the GSP:** `"No records found."` is returned with `code: 204` both when a job genuinely has no rows **and** (plausibly) while a job is still processing. The doc gives no distinct "still pending" / "processing" poll response, and `request_status` is `""` here. A safe poller must bound retries by elapsed time rather than assume `204` means terminal-empty. Mark this as **UNVERIFIED**.

---

## 10. Error handling

### 10.1 The three failure shapes

| Shape | Where | Example |
| --- | --- | --- |
| `{"error": "<text>"}` | `#1` bad credentials only | `{"error": "Unable to login with provided credential"}` |
| `{"results": {"message": "", "errorMessage": "<code>: <text>", "InfoDtls": "", "status": "Failed", "code": 204, …}}` | `#2`–`#9`, `#10A` | `"4005: Eway Bill details are not found"` |
| `{"error": "invalid_request", "error_description": "…"}` | `#10` submit, malformed JSON | `{"error": "invalid_request", "error_description": "Invalid Json Structure."}` |

Parsing rule: the business error is **always the leading integer of `results.errorMessage`**, formatted exactly `"<code>: <message>"` with a colon-space. There is no separate numeric error-code field anywhere in the document.

### 10.2 Every error code that appears in the document

**There is NO complete error-code table in this document.** No appendix, no error-code section, no code+meaning matrix exists — the file ends at line 3450 with the `#10A` failure example. The only codes obtainable are those embedded in example failure payloads. Complete list (all of them, grep-verified):

| Code | Exact message as printed | Appears at | Operation | Retryable? |
| --- | --- | --- | --- | --- |
| `3038` | `Seller details Details:Pincode-101301 does not exists` | L316 | `#2` generate | **No** — bad master data; fix PIN code |
| `2143` | `Invoice does not belongs to the user GSTIN` | L2331 | `#3` cancel | **No** — ownership mismatch |
| `2302` | `Status of the IRN is not active` | L2420 | `#4` gen e-way bill | **No** — IRN cancelled/inactive |
| `2148` | `Requested IRN data is not available` | L2634 | `#5` get by IRN | **No** (or past the 3-day retrieval window) |
| `2154` | `IRN details are not found` | L2740 | `#6` get by doc details | **No** |
| `4005` | `Eway Bill details are not found` | L2777 | `#7` get e-way bill | **No** |
| `3001` | `Requested data is not available` | L2822 | `#8` get GSTIN details | **No** |
| `5001` | `Application Error in Auth, Please Contact the help desk` | L2867 | `#9` sync GSTIN | **Possibly** — doc says contact help desk; `UNVERIFIED` |
| `4013` | `The distance between the pincodes given is too high or low.` | L3341, L3435 | `#10A` poll, inside `InfoDtls` as `ErrorCode` | **No** — correct the distance (see §11 e-way bill rules) |

The retryable classification above is **derived from the message semantics, not stated by the doc**. The doc never labels any code retryable or non-retryable.

**Codes the doc conspicuously does NOT give** (you asked about these specifically):
- **Duplicate IRN** — the rule exists in prose ("Duplicate IRN requests are not considered", L2132) but **no error code is assigned to it**.
- **Invalid GSTIN / GSTIN not active** — the rules exist (L2118, L2146–2149) but **no code is given**.
- **Auth failure / expired token** — only `#1`'s `{"error": "Unable to login with provided credential"}` for bad credentials. **No code for an expired/missing JWT on a business endpoint is documented at all.**

Obtain the full error-code list from Masters India before writing retry logic; do not guess NIC codes.

---

## 11. Critical integration constraints

### 11.1 Sandbox vs production

Only the sandbox host exists in this document (see §1). Every signed artefact (`SignedInvoice` JWT `iss`, `QRCodeUrl`, `EinvoicePdf`, `EwaybillPdf`) points at `sandb-api.mastersindia.co` and `"iss":"NIC Sandbox"`. **Nothing in this document is production-validated.**

### 11.2 IP whitelisting, rate limits, throttling

**`NOT IN DOC` across the board.** Grep for `rate limit`, `throttl`, `whitelist`, `IP address`, `concurrent` returns **zero hits** in all 3,450 lines. There is no documented concurrency limit, QPS limit, or 429 behaviour. The only size/threshold constraints are the 2 MB payload rule (L2178) and the ≤1000 items per invoice rule (L2211). Budget for undocumented throttling; add exponential backoff on transport/5xx/`5001`.

### 11.3 Client GSTIN requirements

- `user_gstin` is a mandatory top-level field on `#2`, `#3`, `#4` and `#10` entries; it is a **query parameter** on `#5`(as `gstin`), `#6`, `#7`, `#8`, `#9`.
- "IRN generation is allowed only for the active Supplier. If he is cancelled or suspended, he cannot generate IRN." (L2118)
- "The Supplier GSTIN can be of taxpayer type REG or SED." (L2183)
- "In case the supplier is SEZ unit, then he cannot generate e-Invoice." (L2140)
- "Request for the IRN/e-Invoice can be made only by the supplier of the goods or services." (L2136)
- "Cancellation can be done by active or suspended taxpayers." (L2358)
- For e-commerce: the operator must be registered as an e-Commerce Operator and "pass eCom_GSTIN accordingly" (L2139); "should include “EcmGstin” attribute and should be the same as their GSTIN" (L2190); "For e-Invoices generated by Suppliers, the “EcmGstin” attribute should be blank." (L2192) — note the doc uses **three different spellings** for this field: `ecommerce_gstin` (schema/example), `eCom_GSTIN`, `EcmGstin`.

### 11.4 `Version` attribute

"‘Version’ attribute in the Schema is **mandatory** and should be latest as per the latest notification. Presently it should be passed as **‘1.1’**." (L2110–2111)

**Contradiction to plan for:** `Version` appears **nowhere** in the request examples, the parameter table, or the request JSON Schema — it is absent from every documented request body. It **does** appear inside the decoded `SignedInvoice` payload as `"Version":"1.1"` (visible in the base64 at L227: `XCJWZXJzaW9uXCI6XCIxLjFcIg==` → `\"Version\":\"1.1\"`). Verify with the GSP whether `version` must be sent as a request field, and in what casing (`Version` vs `version`).

### 11.5 `BillType` / document type

There is **no field named `BillType`** anywhere in the document (grep-verified). The equivalent concept is **`document_type`** with values `"INV"`, `"CRN"`, `"DBN"` (§4.2). The decoded SignedInvoice instead uses `DocDtls.Typ`; do not confuse the GSP request key with NIC's internal JSON keys.

### 11.6 IRN duplicate and re-generation rules

- "Duplicate IRN requests are not considered. That is, if the IRN is already generated on particular type of document and document number of the supplier for the financial year, then one more IRN cannot be generated on the same combination." (L2132–2134)
- "e-invoice(IRN) cannot be re-generated for the cancelled e-invoice(IRN) also." (L2135)
- "Supplier should ensure that the unique invoice number is being generated for the financial year for each invoice, in his ERP/manual system. The financial year is derived from the date of invoice. The financial year starts from 1st April and ends on 31st March." (L2128–2130)
- "Document number should not be starting with 0, / and -. If so, then request is rejected." (L2125)
- "IRN requests with Document Date from 01/10/2022 only will be accepted and processed for IRN generation. IRN requests belonging to previous dates will be rejected." (L2126–2127)
- `#5` retrieval window: "IRN can be retrieved using this API within **three days** from the date of generation of IRN." (L2641)
- "IRN should not be passed as part of the request; it is generated by the e-Invoice system and sent as response." (L2112)

**Client-side implication:** the natural idempotency key is `(user_gstin, document_type, document_number, financial_year)`. Since no duplicate error code is documented, persist the IRN locally and reconcile via `#6` before retrying a failed-looking generate call — a blind retry of a request that actually succeeded will be rejected as a duplicate with an undocumented code.

### 11.7 The 24-hour cancellation rule

"IRN can be cancel within 24 hours of IRN generation." (L2356) Plus: it cannot be cancelled while a valid/active e-way bill exists (L2357). Treat cancellation as a **terminal, non-repeatable** operation; the window is measured from IRN generation, i.e. from `AckDt`, not from your own local timestamp.

### 11.8 E-way bill attachment at IRN time

E-way-bill fields live in `ewaybill_details` inside the `#2` request. Key rules (L2262–2298): the e-way bill may **silently not be generated** even on `"status": "Success"` — "In case incomplete information has been passed for generation of E Way Bill, then IRN will be generated and returned but not E Way Bill number. However subsequently, based on IRN, E Way Bill can be generated." (L2296–2298). Always branch on `EwbNo == null`, never on `status`.

---

## 12. Field-level gotchas

1. **`contract_details` vs `contact_details`.** The parameter table calls the group `contact_details` (L637); the JSON example and the JSON Schema call it `contract_details` (L126, L1875). Use `contract_details` (example+schema win) and flag for GSP confirmation. `invoice_reference_number` is likewise present in the parameter table (L616) but absent from both examples.
2. **`#5` uses `gstin` but `#6`, `#7`, `#8`, `#9` use `user_gstin`.** `#5`'s documented URL is `get-einvoice?gstin=…&irn=…` (L2540). Hard-coding one param name across all four read endpoints will 404 or 400.
3. **`transportation_distance` (`#2`) vs `distance` (`#4`).** The e-way-bill-by-IRN endpoint renames the distance field. Also `#2`'s `ewaybill_details` nests everything under one object, while `#4` puts the same keys flat at the top level.
4. **The response `message` object's key set varies per endpoint.** `#2`/`#10A`: 13 keys incl. `QRCodeUrl`/`EinvoicePdf`/`EwaybillPdf`/`alert`/`error`. `#5`: 9 keys, **no PDF/QR URLs**. `#6`: same + `"Remarks": null`. `#7`: entirely different (`EwbNo`, `Status`, `GenGstin`, `EwbDt`, `EwbValidTill`, `Alert`). `#3`: only `Irn` + `CancelDate`. Never bind a single response model across endpoints.
5. **`alert` vs `Alert`.** Lowercase `alert` in `#2`/`#10A`; capital `Alert` in `#7`. Case-sensitive JSON parsers will lose one of them.
6. **`product_serial_number` is marked `Y` (mandatory) in the parameter table** (L905–906) but is passed as `""` in both examples and is **not** in the schema's item `Required` list. Treat the table marking as suspect; pass it only when items genuinely have unique serials.
7. **`vehicle_number`'s Allowed-Values cell says `"O", "R"`** (L711) — that is `vehicle_type`'s enum, copy/pasted into the wrong row. `vehicle_number` is a 4–20 char string.
8. **`ewaybill_details` required-list conflict.** The table marks `transportation_mode = Y` and `transportation_distance = Y` (L693, L700); the JSON Schema's `Required` array lists **only** `transportation_distance` (L2093–2095); the prose says distance is mandatory (L2263). Follow the prose: distance always, mode whenever any e-way-bill detail is sent.
9. **`round_off_amount` range conflict.** Schema: min `-999`, max `9999.99` (L1701–1705). Validation prose: "can be between **-99.99 and +99.99**" (L2251–2252). Use ±99.99.
10. **`total_cess_value_of_state` is listed twice** with two different maximums (L747 `99,999,999.99` and L777 `9999999999999.99`).
11. **Type inconsistencies in the examples.** `item_serial_number` documented `Number` but passed as string `"501"`; `transportation_distance` documented `String(1-4)` but passed as number `296`; `total_cgst_value` passed as `""` (empty string) in a numeric field; `paid_balance_amount`/`outstanding_amount`/`export_duty` passed as strings; `state_code` passed as `"09"` in some places and `"5"` / `"UTTARAKHAND"` in others. Coerce explicitly.
12. **Decimal precision.** No explicit rounding/precision rule is stated beyond the `Number(...)` ranges (2 decimal places in every monetary range). Only `gst_rate` allows 3 decimals (`0-999.999`). Money tolerance at validation time is **±1 rupee** (§13), not exact-match — so a +0.01 rounding difference will not be rejected.
13. **Date formats are mixed and this is the highest-risk field class.**
    - Request/validation dates: **`DD/MM/YYYY`** (`document_date`, all `*_date` fields, `expiry_date`, `warranty_date`, `preceding_invoice_date`, `transporter_document_date`, `ship_bill_date`) — pattern `[0-3][0-9]/[0-1][0-9]/[2][0][1-2][0-9]`.
    - Response dates: **`YYYY-MM-DD HH:MM:SS`** (`AckDt`, `EwbDt`, `EwbValidTill`, `CancelDate`).
    - `#6`'s query param `document_date=14/09/2023` is unencoded `DD/MM/YYYY`.
    - Max date: "The maximum date value for `RefDtls.DocPerdDtls.InvEndDt` is **31/12/2059**." (L2182) — note this is stated against NIC's internal key names, not the GSP's `invoice_period_end_date`.
14. **`results.message` type switches** between object (success) and `""` (failure) — see §3.
15. **`errorMessage` is a string with an embedded code**, not a code field — parse the leading integer.
16. **Reference-value data.** The document gives NO master-code tables for: state codes, port codes, country codes, currency codes, UQC beyond the `unit` list, cancellation reason codes, or HSN validation. Section `#8` returns `StateCode` as an **integer** (`5`) while requests pass **strings** (`"09"`, `"5"`).
17. **Duplicate key `cess_rate` / `state_cess_rate` are missing from the parameter table** but present in the schema and both examples (L1505, L1532, L190, L193). Include them; they are part of the working payload.
18. **Hard limits worth asserting client-side:** "the document number should not start with 0, / or -" (L2125); "IRN requests with Document Date from 01/10/2022 only" (L2126); "JSON payload size cannot exceed 2MB" (L2178); "Maximum number of items in each invoice should not exceed more than 1000 items and a minimum of 1 item" (L2211–2212); "Tax rate 0.5% is withdrawn" (L2181); "The State code 25 of Daman and Diu is withdrawn under POS" (L2184).

---

## 13. Validation rules (verbatim digest)

### 13.1 General e-invoice validations (L2106–2184)

1. Request JSON must validate against the notified e-Invoice JSON Schema.
2. **`Version` is mandatory and must be `'1.1'`.**
3. IRN must **not** be sent in the request.
4. For string attributes without a defined format, alphanumerics and special characters are allowed **except `"` (double quote) and `\` (back slash)**.
5. IRN generation allowed only for an active Supplier.
6. `supply_type` and `document_type` must come from the master codes.
7. **B2C invoices must not be requested** through this API.
8. Document number must not start with `0`, `/` or `-`.
9. Document Date from **01/10/2022** only; earlier dates rejected.
10. Invoice number must be unique per financial year (1 April – 31 March).
11. Duplicate IRN requests are not considered (same document type + number for the FY).
12. An IRN cannot be re-generated after cancellation.
13. Only the supplier may request the IRN.
14. In e-commerce transactions the e-Commerce Operator may request on the supplier's behalf, must be registered as such, and must pass the e-Commerce GSTIN.
15. An SEZ-unit supplier cannot generate an e-invoice.
16. Reverse charge may be `Y` only for B2B and SEZ invoices; the supplier still generates the IRN.
17. `SEZWP`/`SEZWOP` allowed only when the recipient's taxpayer type is `SEZ Unit` or `SEZ Developer`.
18. Recipient GSTIN must be registered and active or suspended on the document date.
19. If the recipient GSTIN is cancelled, the document date must fall between registration and de-registration.
20. If an SEZ Developer is the supplier, only IGST rates apply.
21. Direct export: recipient GSTIN = URP, state code 96, PIN 999999, POS 96.
22. For state code **97** (OTHER TERRITORY), PIN may be 999999.
23. First two digits of Supplier/Recipient GSTIN must match the respective state code (exception: exports, recipient state code 96).
24. PIN codes validated against states; if not in master, IRN still generates when the first 3 digits match the PIN-to-State mapping.
25. Providing a Shipping party ⇒ "Bill To-Ship To".
26. Providing a Dispatching party ⇒ "Bill From - Dispatch From".
27. Providing both ⇒ combination of both.
28. Export + e-way bill: the Ship-To address must be the Indian port/place of export.
29. IGST-on-intrastate: IGST rates/values must be passed and supplier state code = POS.
30. IGST-on-intrastate ⇒ reverse charge is mandatory.
31. Supplier state code vs POS decides inter/intra-state; `igst_on_intra` overrules.
32. Exports and SEZ are always interstate.
33. **JSON payload ≤ 2 MB.**
34. Reverse charge not applicable when the recipient taxpayer type is ISD.
35. Deemed exports allowed for recipient taxpayer types Regular or Casual.
36. **Tax rate 0.5% is withdrawn.**
37. Max value for `RefDtls.DocPerdDtls.InvEndDt` = **31/12/2059**.
38. Supplier GSTIN taxpayer type must be `REG` or `SED`.
39. State code 25 (Daman and Diu) is withdrawn under POS.

### 13.2 e-Commerce-operator validations (L2185–2196)

1. e-Invoices may be generated by the e-Commerce operator (taxpayer type `TCS`) on behalf of Suppliers.
2. The e-Commerce operator need not be enabled for e-Invoicing.
3. Operator-generated e-Invoices must include `EcmGstin`, equal to their own GSTIN.
4. Supplier-generated e-Invoices must leave `EcmGstin` blank.
5. Operator-generated e-Invoices are accessible to Suppliers for viewing, cancellation and e-way-bill generation.
6. E-way bills generated by operators can also be cancelled by Suppliers.
7. Only e-Commerce operators can generate e-Invoices for e-Commerce transactions.

### 13.3 Item validations (L2197–2212)

1. Item serial number must be **numeric** and is checked for duplicates.
2. Each item needs a valid HSN code of **at least 4 digits**, valid per the GST master.
3. If Is Service = Y, the HSN must belong to services.
4. Each item needs a valid UQC as per master codes, for goods.
5. **Quantity and UQC are mandatory for Goods, optional for Services.**
6. Tax rates validated against allowed rates for all document types incl. CRN/DBN. For intra-state, GST Rate = SGST + CGST rates.
7. Inter-state: IGST rate and value must be passed.
8. Export: IGST rate and value must be passed.
9. Recipient SEZ unit/developer: IGST rate and value must be passed irrespective of recipient state.
10. **Items per invoice: maximum 1000, minimum 1.**

### 13.4 Calculation and summation rules (L2213–2261)

- Taxable Value of Item = Gross Amount of Item − Discount
- SGST Value = Taxable Value × GST Rate / 2 (intra-state); CGST Value = Taxable Value × GST Rate / 2 (intra-state)
- IGST Value = Taxable Value × GST Rate (inter-state)
- Cess Value = Taxable Value × Cess Rate
- State Cess Value = Taxable Value × State Cess Rate
- Total Value of Item = Taxable Value + SGST + CGST + IGST + Cess + State Cess + Non-Advol Cess + State Cess Non-advol + Other charges
- Reverse charge and EXPWP: item total may include **or** exclude tax values.
- **"Temporarily, the validation of 'Gross Amount of Item with Quantity and Selling Unit Price' has been withdrawn."**
- EXPWOP/SEZWOP: passed IGST value is not validated if passed as ZERO even when an actual rate is passed.
- Invoice totals: Total Taxable = Σ items; Total SGST/CGST/IGST = Σ items; Total Cess = Σ (Cess + Non-Advol Cess); Total State Cess = Σ (State Cess + State Cess Non-advol).
- CRN/DBN: IGST/CGST/SGST/CESS values are **not** validated against rates and taxable values.
- **Tolerance: ±1 rupee.** Worked examples: item IGST calculated 2345.04 ⇒ accepted range **2344.00–2347.00**; invoice IGST calculated 10241.00 ⇒ accepted range **10240.00–10242.00**; total invoice value calculated 10241.61 ⇒ accepted range **10240.00–10243.00**.
- `Round_off_amount` may be between **−99.99 and +99.99**.
- Total Invoice Value = Σ Total Value of Items − Invoice Discount + Invoice Other charges + Round-off amount.

### 13.5 E-way bill validations (L2262–2298, restated L2502–2536) — the mandatory-when rules

- E-way bill generation requires e-way-bill details to be passed, **where distance is mandatory**.
- **"E-way Bill is not generated for document types of Debit Note and Credit Note and Services."** (This is the rule that maps a value threshold to a status — value itself is never used as the trigger; document type/service nature is. No monetary threshold appears anywhere in the document.)
- E-way bill generates only if at least one item's HSN belongs to **goods**.
- **Only `transporter_id` provided ⇒ Part-A only.** Transport Mode, Vehicle Type, Vehicle No, transport document number and date must be `null`/absent.
- **Mode = Road ⇒ vehicle number and vehicle type required**; transport document number/date must be absent.
- **Mode = Air/Rail ⇒ transport document number and date required**; vehicle number and type must be absent.
- **Mode = Ship / Road-cum-Ship ⇒ either vehicle number, or transport document number and date, or both; vehicle type must be `ODC`.**
- Vehicle number must match the specified format and exist in the **Vahan** database.
- E-way bill will not generate if Supplier or Recipient GSTIN is **blocked due to non-filing of returns**.
- Recipient GSTIN pincode is mandatory if Ship-To details are not entered.
- Distance validated against the system's auto PIN-PIN distance: allowed **±10 %**; if auto distance < 100 km, allowed range is **1 to +10 %**.
- **Distance passed as `0` ⇒ use the system's auto-calculated PIN-PIN distance**; the actual distance is returned in the "Info. Message" column.
- If no PIN-PIN distance exists in the system, the passed value is used and **must not exceed 4000**.
- If source and destination PIN codes are the same, the actual distance must be passed and must be **1–100**.
- Export + e-way bill: the port address must have been passed as the shipping address at IRN generation (#4 allows passing it later: "If during generation of IRN for export, the shipping address of India is not passed, then the shipping address of the port may be sent now and get the e-way bill generated.").
- Dispatching and/or shipping addresses omitted at IRN time may be supplied in `#4`.
- Incomplete e-way-bill info ⇒ **IRN generated but no e-way bill number**; generate it later from the IRN.

---

## 14. Document gaps that must be closed before production

| # | Gap | Why it blocks production |
| --- | --- | --- |
| 1 | **No production host** | Only `sandb-api` is documented. |
| 2 | **No complete error-code table** | Only 9 codes appear, incidentally, in examples. Retry/alert logic cannot be written. No duplicate-IRN, invalid-GSTIN, or expired-token code is given. |
| 3 | **No token lifetime / refresh contract** | No `expires_in`, no documented 401 body on business endpoints. |
| 4 | **No rate limits / throttling / 429 behaviour / IP whitelisting** | Zero mentions in 3,450 lines. |
| 5 | **No `Content-Type` documented** | All POST bodies are shown as curl `data` blobs. |
| 6 | **No cancellation reason-code table** | `cancel_reason` is a bare string; only `"1"` is shown. |
| 7 | **No bulk max batch size** | `einvoice_list` length is unbounded in the doc. |
| 8 | **No `#10A` HTTP method stated**, and the "still processing" poll response is indistinguishable from "no records found". | |
| 9 | **Examples disagree with the parameter table** in ~12 places (§12) | |
| 10 | **No master-code tables** (state, port, country, currency, cancel reason) | |

---

## 15. Endpoint summary

| # | Purpose | Method | Sandbox URL | Production URL |
| --- | --- | --- | --- | --- |
| 1 | Auth Token — obtain JWT | `POST` | `https://sandb-api.mastersindia.co/api/v1/token-auth/` | not specified |
| 2 | Generate Einvoice / IRN | `POST` | `https://sandb-api.mastersindia.co/api/v1/einvoice/` | not specified |
| 3 | Cancel Einvoice / IRN | `POST` | `https://sandb-api.mastersindia.co/api/v1/cancel-einvoice/` | not specified |
| 4 | Generate e-Way Bill by IRN | `POST` | `https://sandb-api.mastersindia.co/api/v1/gen-ewb-by-irn/` | not specified |
| 5 | Get Einvoice Details By IRN | `GET` | `https://sandb-api.mastersindia.co/api/v1/get-einvoice?gstin={user_gstin}&irn={irn}` | not specified |
| 6 | Get Einvoice Details By Doc Details | `GET` | `https://sandb-api.mastersindia.co/api/v1/get-einvoice-bydoc?user_gstin={gstin}&document_type={INV\|CRN\|DBN}&document_number={no}&document_date={DD/MM/YYYY}` | not specified |
| 7 | Get e-Waybill Details by IRN | `GET` | `https://sandb-api.mastersindia.co/api/v1/get-ewb-byirn?user_gstin={gstin}&irn={irn}` | not specified |
| 8 | Get GSTIN Details | `GET` | `https://sandb-api.mastersindia.co/api/v1/get-gstin-details?user_gstin={gstin}&gstin={gstin_to_lookup}` | not specified |
| 9 | Sync GSTIN Details from CP | `GET` | `https://sandb-api.mastersindia.co/api/v1/sync-gstin?user_gstin={gstin}&gstin={gstin_to_lookup}` | not specified |
| 10 | Generate E-Invoice in Bulk | `POST` (doc writes `Post`) | `https://sandb-api.mastersindia.co/api/v1/einvoiceGenerateInBulk/` | not specified |
| 10A | Get Bulk E-Invoice Response (poll) | not stated in doc (URL is query-param style) | `https://sandb-api.mastersindia.co/api/v1/getBulkEinvoiceResponse?request_id={requestId}` | not specified |

**Every one of these 11 operations carries `Authorization: JWT <token>` except `#1`.** No `Content-Type` is documented for any of them.

---

### Provenance notes

- Line references (`L###`) point at `data/gsp-pdfs/einvoice-api-spec.txt`.
- `SignedInvoice` / `SignedQRCode` base64 blobs are elided in this reference (they are ~5–9 KB each in the source) and marked with their source line ranges. All other example values are reproduced verbatim.
- Two claims in §2.3 (20-hour token) and §9.6 (`204` meaning) are explicitly marked `UNVERIFIED` / inferred and must not be treated as contractual.
