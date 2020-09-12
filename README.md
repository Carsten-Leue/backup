# Carsten's Backup Tool (CBT)

CLI tool and library that creates a backup of a source folder into a target folder. The target folder structure is designed such that the current backup and previous versions can be accessed without the need for additional tooling.

## Installation

```bash
yarn global add @carsten-leue/backup
```

## Usage

```bash
cbt <SRC> <DST>
```

or to get help use

```bash
cbt --help
```

## Folder Structure

The back folder will contain the following sub-folders:

* `current`: contains the latest copy of the source folder.
* `<DATE>`: one folder per run of the backup. These folders contain the differences between the previous and the next version of the files.
