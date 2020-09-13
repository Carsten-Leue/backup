/** Scripts to handle root level folders */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}:\d{2}.\d{3})Z$/;

const toFolderName = (date: Date): string[] => {
  const [_, year, month, day, suffix] = ISO_DATE.exec(date.toISOString());
  return [year, month, day, suffix.replace(/:/g, ".")];
};

export const newRootDir = () => toFolderName(new Date());
