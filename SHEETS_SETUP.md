# Google Sheets setup (phone only, about 15 minutes, one time)

You will do three things: make a Google Sheet, paste `Code.gs` into it, and paste the resulting link into the app.
Use **Chrome** on your phone and the same Google account that you want to own the data.

> Important: Google hides the script editor in the phone Sheets app. Use **Chrome** and switch on
> **Desktop site** (Chrome menu ⋮ → tick "Desktop site"). Zoom in with two fingers when needed.

## Step 1 - Make the Sheet
1. In Chrome open `sheets.google.com` → **Blank spreadsheet**.
2. Tap the title (top left) and rename it **Taj Business Data**.

## Step 2 - Paste the script
1. Menu **Extensions → Apps Script**. A new tab opens with an editor and a file called `Code.gs`.
2. Select everything in the editor and delete it.
3. Open the `Code.gs` file I sent you (from Downloads, in any text/notes viewer or Chrome), **Select all → Copy**, and paste it into the Apps Script editor.
4. Near the top find this line and replace the text between the quotes with your **own long secret** (at least 12 letters and numbers, no spaces). Write it down, you need it again in Step 5:
   `var SECRET_TOKEN = 'PUT-A-LONG-RANDOM-TEXT-HERE';`
5. Tap the **Save** (disk) icon.

## Step 3 - Create the tabs and give permission
1. In the function drop-down at the top choose **setupSheets**, then tap **Run**.
2. Google asks for permission: **Review permissions** → choose your account → **Advanced** → **Go to Untitled project (unsafe)** → **Allow**.
   (It says "unsafe" only because you wrote the script yourself and Google has not reviewed it. It can only touch this one spreadsheet.)
3. Go back to the spreadsheet tab. You should now see tabs: **Sales, SaleItems, Items, Expenses, Inventory, Recipes, Wastage, Credit, Staff, Settings, StockMoves**.

## Step 4 - Publish it as a Web App
1. In Apps Script tap **Deploy → New deployment**.
2. Tap the gear ⚙ next to "Select type" → **Web app**.
3. Fill in:
   - Description: `Taj sync`
   - **Execute as: Me**
   - **Who has access: Anyone**
4. Tap **Deploy**. Copy the **Web app URL**. It looks like `https://script.google.com/macros/s/AKfy...long.../exec` and **must end with `/exec`**.

"Anyone" only means anyone who has the link can reach the door. Nothing happens without your secret token, so keep both the URL and the token private.

## Step 5 - Connect the app
1. Open the Taj app → **More → Settings → Cloud Sync (Google Sheets)**.
2. Paste the **Web App URL** and type your **Secret token** (exactly the same text as in Code.gs).
3. Tap **Save**, then **Test connection**. You should see "Connected to: Taj Business Data".
4. Tap **Sync Now**. The status shows **Success** and your Sheet fills up.
5. Leave "Sync automatically" ticked. From now on:
   - Bills are saved on the phone first, always.
   - With internet, they go to the Sheet by themselves a few seconds after saving.
   - Without internet, they wait and go when internet returns.
   - The ↻ button at the top is Sync Now on every screen. The badge next to it shows **Synced ✓**, **N waiting**, **Offline**, or **Sync error**.

## What each tab means
| Tab | Content |
|---|---|
| Sales | One row per bill (total, discount, cost, payment, customer) |
| SaleItems | One row per item on a bill |
| Items, Recipes | Menu and recipes |
| Inventory | Raw materials with **currentStock** (updated automatically by Google) |
| StockMoves | Every stock in/out: purchase, sale, wastage, count (the extra tab I added) |
| Expenses, Wastage, Credit, Staff, Settings | As named |

Rules for the Sheet: you may read, filter, chart and copy it. **Do not edit or rename row 1 (headers) and never edit the last column named `data`.** Sorting rows is fine. Make your own charts in new tabs.

## Changing Code.gs later
Paste the new code, Save, then **Deploy → Manage deployments → ✏ edit → Version: New version → Deploy**. The URL stays the same. If you change SECRET_TOKEN, also change it in the app.

## If something goes wrong
| App message | Meaning and fix |
|---|---|
| "Wrong secret token" | Token in the app differs from Code.gs. Retype both. |
| "Set SECRET_TOKEN in Code.gs first" | You did not replace the placeholder text. |
| "Google sent a web page instead of data" | Deployment access is not **Anyone**, or you used the editor link instead of the `/exec` link. Redeploy (Step 4). |
| "Could not reach Google" | No internet or wrong URL. Data stays safe on the phone. |
| "Tab ... has changed columns" | Someone edited row 1 of a tab. Restore the original header text. |

## Second phone or lost phone
Install the app on the new phone, make a PIN, then **Settings → paste URL and token → Save → Download everything from cloud**. Bills, stock, udhaar and recipes come back from the Sheet. (PINs are never uploaded; set them again.)

## Honest limits
- If two phones make bills while both are offline, both may use the same visible bill number (for example B0007). The bills are still different and none is lost or merged, only the printed number repeats.
- If the same record is changed on two phones, the newest change wins.
- Wastage photos stay on the phone (and in backup files). They are not uploaded to the Sheet.
- **Restore from backup** replaces the phone's data. With Cloud Sync on, anything already uploaded to the Sheet comes back on the next sync.
- Backup files contain your PIN hash and sync token. Keep them private.
