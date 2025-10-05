import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  let app;
  
  try {
    app = await NestFactory.create(AppModule);
    
    // Enable graceful shutdown hooks
    app.enableShutdownHooks();
    
    const port = process.env.PORT || 80;
    const channelId = process.env.WHATSAPP_CHANNEL_ID || 'default-channel';
    
    await app.listen(port, '0.0.0.0');
    
    logger.log(`🚀 Application is running on: http://0.0.0.0:${port}`);
    logger.log(`📨 Webhook endpoints:`);
    logger.log(`   POST   http://0.0.0.0:${port}/${channelId}/messages`);
    logger.log(`   PATCH  http://0.0.0.0:${port}/${channelId}/chats`);
    logger.log(`🔧 MCP Server: ${process.env.MCP_SERVER_URL || 'NOT SET'}`);
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error(`Uncaught Exception: ${error.message}`, error.stack);
    });
    
    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason) => {
      logger.error(`Unhandled Rejection: ${reason}`);
    });
    
    // Handle process termination signals
    const signals = ['SIGINT', 'SIGTERM'];
    signals.forEach((signal) => {
      process.on(signal, async () => {
        logger.log(`Received ${signal}. Gracefully shutting down...`);
        if (app) {
          await app.close();
        }
        process.exit(0);
      });
    });
    
  } catch (error) {
    logger.error(`Failed to start application: ${error.message}`, error.stack);
    if (app) {
      await app.close();
    }
    process.exit(1);
  }
}

bootstrap();