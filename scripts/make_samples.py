"""Generate the synthetic sample statements used by the app and the tests.

Everything here is made up: a fictional person (Sam Rivera), a fictional bank (Northfield Bank),
twelve months of ordinary spending plus the subscriptions and fees the demo is meant to find.
Deterministic: the same seed always gives the same files.
"""
import csv, datetime as dt, os, random
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'samples')
os.makedirs(OUT, exist_ok=True)
rng = random.Random(20261116)
START, END = dt.date(2025, 11, 1), dt.date(2026, 10, 31)
tx = []  # (date, description, amount)

def add(d, desc, amt):
    if START <= d <= END:
        tx.append((d, desc, round(amt, 2)))

def monthly(day, desc, amt, start=START, end=END, ref=False):
    y, m = start.year, start.month
    while True:
        try:
            d = dt.date(y, m, day)
        except ValueError:
            d = dt.date(y, m, 28)
        if d > end:
            break
        if d >= start:
            a = amt(d) if callable(amt) else amt
            text = desc + (' ' + ''.join(rng.choice('ABCDEFGHJKLMNPQRSTUVWXYZ0123456789') for _ in range(8)) if ref else '')
            add(d, text, -a)
        m += 1
        if m == 13:
            y, m = y + 1, 1

# --- income and rent ---
d = dt.date(2025, 11, 7)
while d <= END:
    add(d, 'DIRECT DEP NORTHWIND LABS PAYROLL', 1440.00)
    d += dt.timedelta(days=14)
monthly(1, 'ZELLE TO J MARTINEZ RENT', 1350.00)

# --- subscriptions (the things the demo should find) ---
monthly(14, 'NETFLIX.COM 866-579-7172 CA', lambda d: 17.99 if d >= dt.date(2026, 9, 1) else 15.49)
monthly(3, 'HULU 877-8244858 CA', 9.99)
monthly(22, 'DISNEY PLUS 888-905-7888 CA', 9.99, start=dt.date(2026, 6, 1))
monthly(9, 'MAX.COM 855-442-6629 NY', 16.99)
monthly(1, 'SPOTIFY USA', 11.99, ref=True)
monthly(19, 'AMZN DIGITAL MUSIC*', 10.99, start=dt.date(2026, 4, 1), ref=True)
monthly(6, 'APPLE.COM/BILL 866-712-7753 CA', 2.99)
monthly(27, 'GOOGLE *GOOGLE ONE G.CO/HELPPAY#', 1.99)
monthly(11, 'ADOBE *CREATIVE CLD 408-536-6000 CA', 59.99)
monthly(25, 'OPENAI *CHATGPT SUBSCR', 20.00)
monthly(17, 'PLANET FIT CLUB FEES', 24.99)
add(dt.date(2026, 6, 17), 'PLANET FIT ANNUAL FEE', -49.00)
add(dt.date(2026, 7, 5), 'NYTIMES*NYTDIGITAL', -1.00)
monthly(5, 'NYTIMES*NYTDIGITAL', 25.00, start=dt.date(2026, 8, 1))
monthly(12, 'AUDIBLE*', 14.95, ref=True)
add(dt.date(2026, 9, 13), 'AUDIBLE* R7KQ2M4X', -14.95)  # charged twice
monthly(8, 'DOORDASH DASHPASS', 9.99)
monthly(20, 'UBER *ONE MEMBERSHIP', 9.99, start=dt.date(2026, 2, 1))
add(dt.date(2025, 11, 18), 'AMAZON PRIME*2K4LM8N0', -139.00)   # yearly, renews soon
add(dt.date(2026, 3, 2), 'DUOLINGO PLUS ANNUAL', -84.99)        # yearly, not soon
monthly(15, 'HEADSPACE INC', 12.99, end=dt.date(2026, 5, 31))    # cancelled in May

# --- bills ---
monthly(21, 'VERIZON WIRELESS PAYMENT', 85.00)
monthly(10, 'COMED ELECTRIC PAYMENT', lambda d: round(rng.uniform(64, 84), 2))
monthly(4, 'STATE FARM INSURANCE', 112.40)
monthly(26, 'COMCAST XFINITY INTERNET', 70.00)

# --- fees ---
for day in (dt.date(2026, 8, 31), dt.date(2026, 9, 30), dt.date(2026, 10, 31)):
    add(day, 'MONTHLY MAINTENANCE FEE', -12.00)
for day, fee in ((dt.date(2026, 6, 8), 1.23), (dt.date(2026, 6, 9), 2.40), (dt.date(2026, 6, 11), 0.87)):
    add(day, 'FOREIGN TRANSACTION FEE', -fee)
for day in (dt.date(2026, 2, 14), dt.date(2026, 5, 2), dt.date(2026, 9, 19)):
    add(day, 'ATM WITHDRAWAL #4410 CHICAGO IL', -60.00)
    add(day, 'NON-NETWORK ATM FEE', -3.50)

# --- everyday spending (noise the detector must ignore) ---
d = START
while d <= END:
    wd = d.weekday()
    if wd == 5: add(d, "TRADER JOE S #552 CHICAGO IL", -rng.uniform(45, 120))
    if wd == 2 and rng.random() < 0.5: add(d, 'KROGER #0871 CHICAGO IL', -rng.uniform(20, 70))
    if wd in (0, 2, 4) and rng.random() < 0.8: add(d, f'STARBUCKS STORE {rng.randint(10000, 99999)}', -rng.uniform(4.25, 8.95))
    if wd == 1 and rng.random() < 0.6: add(d, 'SQ *BLUE BOTTLE 8573 CHICAGO IL', -rng.uniform(5, 9))
    if rng.random() < 0.12: add(d, 'CHIPOTLE 2210 CHICAGO IL', -rng.uniform(11, 16))
    if rng.random() < 0.10: add(d, f'SHELL OIL {rng.randint(1000000, 9999999)}', -rng.uniform(32, 55))
    if rng.random() < 0.08: add(d, 'UBER *TRIP HELP.UBER.COM', -rng.uniform(9, 28))
    if rng.random() < 0.10: add(d, f'AMAZON MKTPL*{rng.randint(100000, 999999)}', -rng.uniform(12, 80))
    if rng.random() < 0.04: add(d, 'TARGET 00012345 CHICAGO IL', -rng.uniform(15, 90))
    if rng.random() < 0.03: add(d, 'CVS/PHARMACY #0631', -rng.uniform(6, 30))
    d += dt.timedelta(days=1)
# an unexpected car repair at the end of July (this is what tips the account into overdraft)
add(dt.date(2026, 7, 27), 'MIDAS AUTO SERVICE #0412', -1150.00)
# a trip abroad in June
for day, desc, amt in ((dt.date(2026, 6, 8), 'HOTEL LISBOA CENTRO LISBON PT', 41.00), (dt.date(2026, 6, 9), 'PINGO DOCE LISBOA PT', 80.10), (dt.date(2026, 6, 11), 'CP COMBOIOS DE PORTUGAL', 29.00)):
    add(day, desc, -amt)

tx.sort(key=lambda t: (t[0], t[1]))

# Overdraft fees land the day after the balance first dips below zero in a month (realistic).
run, flagged = 1900.00, set()
for d, desc, amt in list(tx):
    run += amt
    if run < 0 and (d.year, d.month) not in flagged:
        flagged.add((d.year, d.month))
        add(d + dt.timedelta(days=1), 'OVERDRAFT ITEM FEE', -35.00)
        run -= 35.00
tx.sort(key=lambda t: (t[0], t[1]))

# Checking account CSV (BoA-like): Date, Description, Amount, Running Bal.
bal = 1900.00
with open(os.path.join(OUT, 'northfield-checking-12-months.csv'), 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['Description', '', 'Summary Amt.'])
    w.writerow(['Beginning balance as of 11/01/2025', '', f'{bal:.2f}'])
    w.writerow([])
    w.writerow(['Date', 'Description', 'Amount', 'Running Bal.'])
    for d, desc, amt in tx:
        bal += amt
        w.writerow([d.strftime('%m/%d/%Y'), desc, f'{amt:.2f}', f'{bal:.2f}'])

# The last three months as a PDF statement.
def money(x):
    return f'{x:,.2f}'
pdf_path = os.path.join(OUT, 'northfield-statement-aug-oct-2026.pdf')
c = canvas.Canvas(pdf_path, pagesize=letter)
W, H = letter
period = [t for t in tx if t[0] >= dt.date(2026, 8, 1)]
start_bal = 1900.00 + sum(a for d, _, a in tx if d < dt.date(2026, 8, 1))
def header(page):
    c.setFont('Helvetica-Bold', 15); c.drawString(54, H - 60, 'Northfield Bank')
    c.setFont('Helvetica', 9)
    c.drawString(54, H - 76, 'Everyday Checking  ·  Sam Rivera  ·  Account ending in ••••')
    c.drawString(54, H - 89, 'Statement period: August 1, 2026 – October 31, 2026')
    c.drawRightString(W - 54, H - 60, f'Page {page}')
    c.setFont('Helvetica-Bold', 9)
    c.drawString(54, H - 118, 'Date'); c.drawString(100, H - 118, 'Description')
    c.drawRightString(W - 140, H - 118, 'Amount'); c.drawRightString(W - 54, H - 118, 'Balance')
    c.line(54, H - 123, W - 54, H - 123)
    c.setFont('Helvetica', 9)
page, y, bal = 1, H - 138, start_bal
header(page)
for d, desc, amt in period:
    bal += amt
    if y < 60:
        c.showPage(); page += 1; header(page); y = H - 138
    c.drawString(54, y, d.strftime('%m/%d'))
    c.drawString(100, y, desc[:58])
    c.drawRightString(W - 140, y, ('-' if amt < 0 else '') + money(abs(amt)))
    c.drawRightString(W - 54, y, money(bal))
    y -= 13
c.showPage(); c.save()

# A credit card export where purchases are positive numbers (the app must flip the sign).
card = [
    (dt.date(2026, 8, 2), 'PELOTON* MEMBERSHIP', 44.00), (dt.date(2026, 9, 2), 'PELOTON* MEMBERSHIP', 44.00), (dt.date(2026, 10, 2), 'PELOTON* MEMBERSHIP', 44.00),
    (dt.date(2026, 8, 7), 'CANVA* I04221-1234', 0.00), (dt.date(2026, 9, 7), 'CANVA* I04987-5678', 14.99), (dt.date(2026, 10, 7), 'CANVA* I05112-9012', 14.99),
    (dt.date(2026, 8, 16), 'PARAMOUNT+ 888-274-5343', 7.99), (dt.date(2026, 9, 16), 'PARAMOUNT+ 888-274-5343', 7.99), (dt.date(2026, 10, 16), 'PARAMOUNT+ 888-274-5343', 12.99),
    (dt.date(2026, 8, 12), 'WHOLE FOODS MKT #10232', 86.41), (dt.date(2026, 8, 30), 'DELTA AIR 0062345678901', 312.40),
    (dt.date(2026, 9, 21), 'SWEETGREEN CHICAGO', 15.32), (dt.date(2026, 10, 3), 'BEST BUY 00015', 129.99),
    (dt.date(2026, 9, 25), 'PAYMENT - THANK YOU', -500.00), (dt.date(2026, 10, 25), 'PAYMENT - THANK YOU', -400.00),
    (dt.date(2026, 10, 28), 'INTEREST CHARGE ON PURCHASES', 18.62),
]
card.sort()
with open(os.path.join(OUT, 'card-export-aug-oct-2026.csv'), 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['Date', 'Description', 'Card Member', 'Amount'])
    for d, desc, amt in card:
        w.writerow([d.strftime('%m/%d/%Y'), desc, 'SAM RIVERA', f'{amt:.2f}'])

print(len(tx), 'checking transactions;', len(period), 'in the PDF;', len(card), 'card rows')
