package com.example.formsync.store;

import com.example.formsync.model.FormState;
import com.example.formsync.repository.FormRepository;
import org.springframework.stereotype.Component;

/**
 * 폼 상태 접근 진입점 (명세 §8.1). {@link FormRepository}를 통해 저장소를 추상화한다.
 * getOrCreate는 신규/재연결 스냅샷의 기준 상태를 보장한다.
 */
@Component
public class FormStore {

    private final FormRepository repository;

    public FormStore(FormRepository repository) {
        this.repository = repository;
    }

    public FormState getOrCreate(String formId) {
        FormState existing = repository.load(formId);
        if (existing != null) {
            return existing;
        }
        // 2명 시나리오라 경합은 드물지만, 동시 첫 접속 시 상태가 두 번 만들어지지 않도록 동기화.
        synchronized (formId.intern()) {
            FormState rechecked = repository.load(formId);
            if (rechecked != null) {
                return rechecked;
            }
            FormState created = FormState.empty(formId);
            repository.save(created);
            return created;
        }
    }
}
