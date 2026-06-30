# syntax=docker/dockerfile:1

# ── 1단계: 빌드 ──────────────────────────────────────────────
# Gradle wrapper(8.14.5)와 동일한 라인을 쓰되, JDK 21 이미지를 사용한다.
FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace

# 의존성 캐시 레이어: 래퍼와 빌드 스크립트를 먼저 복사한다.
COPY gradlew settings.gradle build.gradle ./
COPY gradle ./gradle
RUN chmod +x gradlew && ./gradlew --no-daemon dependencies || true

# 소스 복사 후 부트 JAR 빌드 (테스트는 배포 빌드에서 제외)
COPY src ./src
RUN ./gradlew --no-daemon clean bootJar -x test

# ── 2단계: 실행 ──────────────────────────────────────────────
# JRE만 담아 이미지를 가볍게 유지한다.
FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app

# 비루트 사용자로 실행
RUN useradd -r -u 1001 spring
USER spring

COPY --from=build /workspace/build/libs/*-SNAPSHOT.jar app.jar

# Render는 PORT 환경변수를 주입한다. 미설정 시 8080으로 동작.
ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["sh", "-c", "java ${JAVA_OPTS} -Dserver.port=${PORT} -jar app.jar"]
