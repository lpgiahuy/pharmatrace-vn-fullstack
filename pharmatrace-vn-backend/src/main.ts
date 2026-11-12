import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { NestExpressApplication } from "@nestjs/platform-express";
import { join } from "path";
import { HttpExceptionFilter, validationException } from "./common/errors/http-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Serve static assets from uploads directory
  app.useStaticAssets(join(process.cwd(), "uploads"), {
    prefix: "/uploads/",
  });

  // 1. Enable CORS for Next.js
  app.enableCors({
    origin: ["http://localhost:3000", "http://localhost"],
    credentials: true,
  });


  // 2. Global API prefix
  app.setGlobalPrefix("v1/pharmatrace");

  // 3. Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationException,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  // 4. Swagger API Documentation
  const config = new DocumentBuilder()
    .setTitle("PharmaTrace VN API")
    .setDescription(
      "PharmaTrace VN Pharmaceutical Supply Chain & Traceability System",
    )
    .setVersion("1.0")
    .addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        name: "JWT",
        description: "Enter JWT token (without Bearer prefix)",
        in: "header",
      },
      "bearerAuth",
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api-docs", app, document);

  const PORT = process.env.PORT || 3002;
  await app.listen(PORT);
  console.log(
    `NestJS Backend running at http://localhost:${PORT}/v1/pharmatrace`,
  );
  console.log(`Swagger Docs available at http://localhost:${PORT}/api-docs`);
}
void bootstrap();
