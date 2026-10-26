# Hypercube Office Privacy

Last updated: October 9, 2026

Hypercube Office opens, edits and saves documents on your computer. It has no
accounts, no AI features, no usage analytics and no automatic updates, and it
never uploads your documents anywhere.

## Network use

The app works fully offline and never connects to the internet on its own.
Starting the app or opening a PDF, Word, Excel, PowerPoint, Markdown or HTML
file makes no network request. It only touches the network when you ask it to:

- an HTML document's web pictures, fonts and scripts stay blocked until you
  click **Load web content** above its preview (for that tab only); printing
  or exporting an HTML document loads them, as a web browser would
- inserting an image from a web address downloads that image
- pasting content copied from a web page into a Word document downloads its
  pictures, and exporting a Markdown note with web pictures to Word, PDF or
  images downloads those pictures
- cropping, cutting out or saving ("Save image as…") a web picture in the HTML
  editor, or saving one in the Markdown editor, downloads that picture
- clicking a link opens it in your default browser
- the update check, off by default, asks GitHub Releases
  (`api.github.com`) whether a newer version exists, when you click
  **Check now** in Settings > About or once a day after you turn it on there;
  it sends no information about you or your files. **Download and install**
  downloads the new version from `github.com`

Each of these requests shows the website your computer's internet address and
the time; no document content is sent.

Spell checking uses English dictionaries shipped with the app and never
downloads dictionaries; on a computer set to another language it checks in
English (on macOS the system spell checker is used).

## Data stored on your computer

Settings, recent files and autosave recovery copies are kept in the app's
user-data folder on your computer. Uninstalling the app and deleting that
folder removes them.
