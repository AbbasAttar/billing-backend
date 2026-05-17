import { connectDB } from './config/database';
import { env } from './config/env';
import app from './app';

const start = async () => {
  await connectDB();

  app.listen(env.PORT, () => {
    console.log(`🚀 Server running on http://localhost:${env.PORT}`);
    console.log(`   Environment: ${env.NODE_ENV}`);
  });
};

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
