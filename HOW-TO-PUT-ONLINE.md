# Putting the site online

You do this once. After that, the site runs 24/7 on Render and updates itself whenever the files on GitHub change.

Cost: about **$7.25 a month** on Render ($7 for the always-on server plus about $0.25 for 1 GB of storage that keeps the price history). GitHub and the CoinGecko key are free.

---

## Step 1: Put the files on GitHub (free)

1. Go to **github.com** and click **Sign up**. Make an account.
2. Click the **+** at the top right, then **New repository**.
   - Repository name: `truecap` (you can rename it later)
   - Choose **Private**
   - Click **Create repository**
3. On the next page, click the link **"uploading an existing file"**.
4. Open your `XBTcap\xbtcap` folder in File Explorer. Select **everything inside it except the `data` folder** (Ctrl+A, then Ctrl+click `data` to unselect it), and drag it onto the GitHub page.
5. Wait for the uploads to finish, then click **Commit changes**.

## Step 2: Get a free CoinGecko key

Cloud servers share internet addresses, so CoinGecko limits them more strictly than your home computer. A free "Demo" key avoids that.

1. Go to **coingecko.com/en/api**, choose the free **Demo** plan, and create an account.
2. In the developer dashboard, click **+ Add New Key** and copy the key. It starts with `CG-`.

## Step 3: Start the site on Render

1. Go to **render.com** and click **Get Started**. Choose **Sign up with GitHub**, so Render can see your files.
2. Click **New +**, then **Blueprint**.
3. Pick your `truecap` repository. Render reads the setup file (`render.yaml`) automatically.
4. When it asks for `COINGECKO_API_KEY`, paste your key from Step 2.
5. Click **Apply**. Render will ask for a payment card for the $7 server.
6. After a minute or two, your site is live at an address like `https://truecap.onrender.com` (if that's taken, Render adds a few letters).

## Step 4 (later): Use your own web address

Once you've bought your domain, in Render open the service, go to **Settings → Custom Domains**, and add it. Render shows the two records to enter at your domain registrar. HTTPS (the padlock) is set up automatically.

## Changing the site's name

Open `config.json` and change `"siteName": "TrueCap"` to your new name. Upload the changed file to GitHub, and Render updates the site within a few minutes.
