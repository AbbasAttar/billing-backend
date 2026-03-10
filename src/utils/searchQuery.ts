export const buildSearchQuery = (q: string, fields: string[]) => {
  if (!q) return {};
  const regex = { $regex: q, $options: 'i' };
  return {
    $or: fields.map((field) => ({ [field]: regex })),
  };
};
