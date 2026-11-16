# [FICTIONAL] en-1 — intended variations and inconsistencies

One fictional plant (f-hollinmere), two files: an English star chart (.xlsx) and an English CMMS work-order export (.csv).

Variations (layout)
- Financial-year columns written as "2019/20" … "2030/31" (UK style), FY starts April.
- Marks are letters: X = completed, P = planned. Legend at the bottom of the sheet.
- Band row above the year headers ("ACTUAL" / "2026/27 (current year)" / "PLAN", merged cells).
- The current year 2026/27 has two sub-columns, "Plan" and "Actual"; one row has both P and X in that year (same work).
- Hierarchy: numbered system heading rows (1 … 5) with equipment rows below; one equipment (Stoker grate - Line 1) has a second task row with a blank name cell (continuation row).
- Line column mixes numbers (1, 2) and text ("Common", "All").
- A plant-wide row ("Whole plant (both lines)") with no tag: the 3-yearly detailed functional inspection (precision inspection), covering all equipment.
- Second sheet "Revision log" (not plan content).
- CSV: title line, export line, blank line, then header on physical row 4; footer "16 record(s)". CRLF line ends, UTF-8 without BOM. Dates DD/MM/YYYY.
- One CSV description contains a line break inside quotes (record spans physical rows 15-16).

Inconsistencies (content)
- Asset names in the CSV differ from the chart ("Refuse Crane 1", "Crane 1", "Crane No1", "Refuse Crane #2", "Stoker Grate L1", "Grate Line 2", "Boiler 2 - Superheater", "BFW Pump A", "BFP B", "Bag House 1", "ID Fan No.1", "ID Fan 1", "Plant (all)").
- Man-hours mostly numbers, but one is "3 men x 3 days" and one is blank with "approx. 6 man-days" in Comments.
- One work (Boiler - Line 2 superheater, 2022) is split over two CSV rows (phase 1 / phase 2).
- Boiler feed water pump B: chart X in 2024/25, but the CSV shows it was done 08-17/04/2025 (FY2025). Truth: FY2025.
- Two breakdown repairs are in the CSV only (ID fan No.1 Jan 2024, Crane 1 Aug 2024).
- Chart works before April 2022 have no CSV rows (CMMS starts then).
- Planning gaps (defects): ID fan Line 2 P in 2024/25 never done and not re-planned; Bag filter Line 2 has no next replacement; Refuse crane No.1 has no next P although interval is 3 yrs.
- Boiler - Line 1 has no future plan and no interval, but a remark explains it (not counted as a defect).
