export const calculateTotal = (items: Array<{ quantity: number; price: number }>): number => {
  return items.reduce((sum, item) => sum + item.quantity * item.price, 0);
};
