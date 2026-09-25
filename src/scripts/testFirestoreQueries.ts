import { Customer } from '../models/Customer.model';
import { Invoice } from '../models/Invoice.model';
import { Frame } from '../models/Frame.model';
import { Fragrance } from '../models/Fragrance.model';
import { connectDB } from '../config/database';

async function testQueries() {
  console.log('Testing Firestore API Model Queries...');
  await connectDB();

  const customerCount = await Customer.countDocuments();
  console.log(`✅ Customer.countDocuments(): ${customerCount}`);

  const sampleCustomer = await Customer.findOne();
  console.log(`✅ Sample Customer: ${sampleCustomer?.name} (Mobile: ${sampleCustomer?.mobileNumber})`);

  const invoiceCount = await Invoice.countDocuments();
  console.log(`✅ Invoice.countDocuments(): ${invoiceCount}`);

  const sampleInvoice = await Invoice.findOne();
  console.log(`✅ Sample Invoice: #${sampleInvoice?.invoiceNumber} - Total: ₹${sampleInvoice?.total}`);

  const frameCount = await Frame.countDocuments();
  console.log(`✅ Frame.countDocuments(): ${frameCount}`);

  const fragranceCount = await Fragrance.countDocuments();
  console.log(`✅ Fragrance.countDocuments(): ${fragranceCount}`);

  console.log('\n🎉 ALL FIRESTORE MODEL QUERIES WORKING PERFECTLY!');
  process.exit(0);
}

testQueries().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
