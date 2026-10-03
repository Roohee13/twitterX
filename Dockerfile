# Build stage: dependencies are resolved in their own layer so code changes rebuild fast.
FROM eclipse-temurin:17-jdk AS build
WORKDIR /app
COPY .mvn .mvn
COPY mvnw pom.xml ./
RUN ./mvnw -B -q dependency:go-offline
COPY src src
RUN ./mvnw -B -q package -DskipTests

# Runtime stage: JRE only, runs as a non-root user.
FROM eclipse-temurin:17-jre
RUN useradd --system --no-create-home app
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
USER app
EXPOSE 8080
# Configuration comes from environment variables (see .env.example). JWT_SECRET is required.
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "app.jar"]
