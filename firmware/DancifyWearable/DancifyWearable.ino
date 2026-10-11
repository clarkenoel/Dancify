#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <esp_timer.h>
#include <esp_arduino_version.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include <atomic>
#include "FeedbackEngine.h"
#include "Controls.h"

#if !defined(CONFIG_IDF_TARGET_ESP32S3)
#error "Select ESP32S3 Dev Module: these pins are for Waveshare ESP32-S3 Zero."
#endif

// Confirmed hardware: ESP32-S3 Zero, active buzzers, limited-travel Grove sensor.
constexpr int BUZZER_PIN = 7;
constexpr int BUTTON_PIN = 10;
constexpr int POT_PIN = 8;  // ESP32-S3 ADC1_CH7 (classic ESP32 pin rules differ).
constexpr bool ACTIVE_BUZZER = true;
constexpr bool BUZZER_ACTIVE_LOW = false;
constexpr bool ROTARY_REVERSED = false;  // Flip if clockwise sends DIR:UP.
constexpr bool USB_COMMANDS = true;      // Bench control only while BLE disconnected.

constexpr char SERVICE_UUID[] = "7a2b0001-8f4c-4a6e-9b1d-3c5e7f9a0b1c";
constexpr char RX_UUID[] = "7a2b0002-8f4c-4a6e-9b1d-3c5e7f9a0b1c";
constexpr char TX_UUID[] = "7a2b0003-8f4c-4a6e-9b1d-3c5e7f9a0b1c";

struct RxPacket { uint32_t epoch; uint16_t length; char data[128]; };
QueueHandle_t rxQueue = nullptr;
BLECharacteristic *txChar = nullptr;
BLE2902 *txSubscription = nullptr;
std::atomic<bool> connected{false}, rxFault{false}, advertiseAgain{false};
std::atomic<uint32_t> connectionEpoch{0};
dancify::Rotary rotary;
dancify::Button button;

// Called ONLY by feedbackTask after setup; no competing writes to the buzzer.
void setBuzzerFrequency(uint32_t hz) {
  static uint32_t previous = UINT32_MAX;
  // An active buzzer contains its own oscillator: drive an ON/OFF envelope.
  const uint32_t output = ACTIVE_BUZZER ? (hz != 0) : hz;
  if (output == previous) return;
  previous = output;
  if (ACTIVE_BUZZER) {
    digitalWrite(BUZZER_PIN, ((output != 0) != BUZZER_ACTIVE_LOW) ? HIGH : LOW);
  } else {
    // Optional passive-piezo build. Uses LEDC, never Arduino tone().
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcWriteTone(BUZZER_PIN, hz);
#else
    ledcWriteTone(0, hz);
#endif
  }
}

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *) override {
    connectionEpoch.fetch_add(1);
    connected.store(true);
  }
  void onDisconnect(BLEServer *) override {
    connected.store(false);
    connectionEpoch.fetch_add(1);  // Invalidates all commands from this connection.
    advertiseAgain.store(true);
  }
};
class RxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *characteristic) override {
    if (!connected.load()) return;
    const auto value = characteristic->getValue();
    RxPacket packet{};
    if (value.length() > sizeof(packet.data)) { rxFault.store(true); return; }
    packet.epoch = connectionEpoch.load();
    packet.length = static_cast<uint16_t>(value.length());
    memcpy(packet.data, value.c_str(), packet.length);
    if (xQueueSend(rxQueue, &packet, 0) != pdTRUE) rxFault.store(true);
  }
};

void feedbackTask(void *) {
  dancify::FeedbackEngine engine;
  dancify::LineDecoder bleDecoder, usbDecoder;
  uint32_t epoch = connectionEpoch.load();
  for (;;) {
    const uint32_t currentEpoch = connectionEpoch.load();
    if (currentEpoch != epoch) {
      epoch = currentEpoch;
      engine.stop(); bleDecoder.reset(); usbDecoder.reset();
      setBuzzerFrequency(0);
    }
    if (rxFault.exchange(false)) {
      // Loss of any bytes must never splice two commands into a valid command.
      xQueueReset(rxQueue); engine.stop(); bleDecoder.discardUntilNewline();
      setBuzzerFrequency(0);
    }
    engine.tick(esp_timer_get_time());  // Enforce timeout before accepting SYNC.
    RxPacket packet;
    for (int budget = 0; budget < 8 && xQueueReceive(rxQueue, &packet, 0) == pdTRUE; ++budget) {
      if (packet.epoch != epoch || !connected.load()) continue;
      for (uint16_t i = 0; i < packet.length; ++i) {
        bleDecoder.feed(packet.data[i], engine, esp_timer_get_time());
      }
    }
    for (int budget = 0; budget < 64 && Serial.available(); ++budget) {
      const char c = static_cast<char>(Serial.read());
      if (USB_COMMANDS && !connected.load()) usbDecoder.feed(c, engine, esp_timer_get_time());
    }
    // A disconnect during parsing wins over any packet we just processed.
    if (epoch != connectionEpoch.load()) engine.stop();
    setBuzzerFrequency(engine.tick(esp_timer_get_time()));
    vTaskDelay(1);
  }
}

void notifyEvent(const char *event) {
  // Every event fits the default MTU's 20-byte payload, including newline.
  if (!connected.load() || !txSubscription->getNotifications()) return;
  char line[20];
  const int count = snprintf(line, sizeof(line), "%s\n", event);
  if (count <= 0 || count >= static_cast<int>(sizeof(line))) return;
  txChar->setValue(reinterpret_cast<uint8_t *>(line), count);
  txChar->notify();
}

void setupBLE() {
  BLEDevice::init("Dancify-Wearable");
  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  BLEService *service = server->createService(SERVICE_UUID);
  txChar = service->createCharacteristic(TX_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  txSubscription = new BLE2902();
  txChar->addDescriptor(txSubscription);
  BLECharacteristic *rx = service->createCharacteristic(RX_UUID, BLECharacteristic::PROPERTY_WRITE);
  rx->setCallbacks(new RxCallbacks());
  service->start();
  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);  // Name + 128-bit service require both packets.
  BLEDevice::startAdvertising();
}

void setup() {
  Serial.begin(115200);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, BUZZER_ACTIVE_LOW ? HIGH : LOW);
  if (!ACTIVE_BUZZER) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    if (!ledcAttach(BUZZER_PIN, 1800, 8)) {
      Serial.println("ERROR: LEDC setup failed");
      while (true) delay(1000);
    }
#else
    ledcSetup(0, 1800, 8); ledcAttachPin(BUZZER_PIN, 0);
#endif
  }
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(POT_PIN, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(POT_PIN, ADC_11db);
  button.reset(digitalRead(BUTTON_PIN) == LOW, millis());
  rxQueue = xQueueCreate(32, sizeof(RxPacket));
  if (!rxQueue || xTaskCreate(feedbackTask, "Feedback", 4096, nullptr, 2, nullptr) != pdPASS) {
    Serial.println("ERROR: feedback task allocation failed");
    while (true) delay(1000);
  }
  setupBLE();
  Serial.println("READY Dancify-Wearable; stopped. Commands require newline.");
}

void loop() {
  static uint32_t inputEpoch = UINT32_MAX, lastSensorAt = 0;
  static bool advertisingPending = false;
  static uint32_t advertiseAt = 0;
  const uint32_t now = millis();
  const uint32_t epoch = connectionEpoch.load();
  if (inputEpoch != epoch) {
    inputEpoch = epoch; rotary.reset();
    button.reset(digitalRead(BUTTON_PIN) == LOW, now);
  }
  if (advertiseAgain.exchange(false)) { advertisingPending = true; advertiseAt = now + 300; }
  if (advertisingPending && static_cast<int32_t>(now - advertiseAt) >= 0) {
    advertisingPending = false;
    if (!connected.load()) BLEDevice::startAdvertising();
  }
  const uint8_t events = button.update(digitalRead(BUTTON_PIN) == LOW, now);
  if (events & dancify::DOWN) notifyEvent("BTN:DOWN");
  if (events & dancify::UP) notifyEvent("BTN:UP");
  if (events & dancify::CLICK) notifyEvent("BTN:CLICK");
  if (events & dancify::HOLD) notifyEvent("BTN:HOLD");

  if (now - lastSensorAt >= 10) {
    lastSensorAt = now;
    uint32_t total = 0;
    for (int i = 0; i < 4; ++i) total += analogRead(POT_PIN);
    int step = rotary.update(total / 4, now);
    if (ROTARY_REVERSED) step = -step;
    if (step > 0) notifyEvent("DIR:DOWN");
    if (step < 0) notifyEvent("DIR:UP");
  }
  delay(1);
}
